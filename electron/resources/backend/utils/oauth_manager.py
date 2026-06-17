"""
OAuth认证管理器
处理各个平台的OAuth授权流程
"""

import secrets
import hashlib
from typing import Dict, Optional, Any
from urllib.parse import urlencode
import requests
from datetime import datetime, timedelta

class OAuthManager:
    """OAuth认证管理器"""
    
    # OAuth配置 - 每个平台的配置
    # 
    # 🟢 容易申请：GitHub (5分钟), Google/YouTube (10分钟)
    # 🟡 中等难度：X/Twitter (需付费)
    # 🔴 困难：小红书、抖音、B站 (需企业资质或审核困难)
    
    OAUTH_CONFIGS = {
        # ============ 🟢 推荐：个人开发者可以快速申请 ============
        
        "github": {
            # GitHub OAuth - 最简单！个人账号5分钟搞定
            # 申请地址: https://github.com/settings/developers
            # 1. 点击 "New OAuth App"
            # 2. Application name: AI Media Agent (随便起名)
            # 3. Homepage URL: http://localhost:3000
            # 4. Authorization callback URL: http://localhost:3000/api/connectors/oauth/callback
            # 5. 创建后获得 Client ID 和 Client Secret
            "client_id": "Ov23liX94doSXYaOpSil",
            "client_secret": "74fa7b07f14ff3836fa5e65840a497845a4d3206",
            "authorize_url": "https://github.com/login/oauth/authorize",
            "token_url": "https://github.com/login/oauth/access_token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "read:user user:email"
        },
        
        "google": {
            # Google OAuth - 适用于YouTube等Google服务
            # 申请地址: https://console.cloud.google.com/apis/credentials
            # 1. 创建项目
            # 2. 启用YouTube Data API v3
            # 3. 创建OAuth 2.0客户端ID
            # 4. 应用类型选择"Web应用"
            # 5. 授权重定向URI: http://localhost:3000/api/connectors/oauth/callback
            "client_id": "YOUR_GOOGLE_CLIENT_ID",
            "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
            "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
            "token_url": "https://oauth2.googleapis.com/token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.profile"
        },
        
        # ============ 🟡 中等难度：需要审核或付费 ============
        
        "x": {
            # X (Twitter) OAuth - 需要付费订阅
            # 申请地址: https://developer.twitter.com/en/portal/dashboard
            # 需要Twitter Developer账号（可能需要付费）
            "client_id": "YOUR_TWITTER_CLIENT_ID",
            "client_secret": "YOUR_TWITTER_CLIENT_SECRET",
            "authorize_url": "https://twitter.com/i/oauth2/authorize",
            "token_url": "https://api.twitter.com/2/oauth2/token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "tweet.read tweet.write users.read"
        },
        
        # ============ 🔴 困难：需要企业资质或审核严格 ============
        
        "xiaohongshu": {
            # 小红书 - 需要MCN机构或企业资质，个人很难申请
            "client_id": "YOUR_XHS_APP_ID",
            "client_secret": "YOUR_XHS_APP_SECRET",
            "authorize_url": "https://edith.xiaohongshu.com/oauth/authorize",
            "token_url": "https://edith.xiaohongshu.com/oauth/token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "publish"
        },
        "douyin": {
            # 抖音 - 需要企业认证
            "client_key": "YOUR_DOUYIN_CLIENT_KEY",
            "client_secret": "YOUR_DOUYIN_CLIENT_SECRET",
            "authorize_url": "https://open.douyin.com/platform/oauth/connect",
            "token_url": "https://open.douyin.com/oauth/access_token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "video.create,video.data"
        },
        "weibo": {
            # 微博 - 审核较严
            "client_id": "YOUR_WEIBO_APP_KEY",
            "client_secret": "YOUR_WEIBO_APP_SECRET",
            "authorize_url": "https://api.weibo.com/oauth2/authorize",
            "token_url": "https://api.weibo.com/oauth2/access_token",
            "redirect_uri": "http://localhost:3000/api/connectors/oauth/callback",
            "scope": "statuses_to_me_read,statuses_to_me_write"
        }
    }
    
    def __init__(self):
        # 存储state和PKCE verifier（生产环境应使用Redis）
        self.pending_states: Dict[str, Dict[str, Any]] = {}
    
    def generate_authorization_url(self, platform: str) -> Dict[str, str]:
        """
        生成OAuth授权URL
        
        Args:
            platform: 平台ID
            
        Returns:
            包含authorization_url和state的字典
        """
        config = self.OAUTH_CONFIGS.get(platform)
        if not config:
            raise ValueError(f"Platform {platform} not supported")
        
        # 生成state用于防止CSRF攻击
        state = secrets.token_urlsafe(32)
        
        # 生成PKCE参数（推荐用于移动端和公共客户端）
        code_verifier = secrets.token_urlsafe(64)
        code_challenge = hashlib.sha256(code_verifier.encode()).hexdigest()
        
        # 保存state和verifier
        self.pending_states[state] = {
            "platform": platform,
            "code_verifier": code_verifier,
            "timestamp": datetime.now()
        }
        
        # 构建授权URL参数
        params = {
            "client_id": config.get("client_id") or config.get("client_key"),
            "response_type": "code",
            "redirect_uri": f"{config['redirect_uri']}?platform={platform}",
            "state": state,
            "scope": config["scope"]
        }
        
        # 某些平台需要PKCE
        if platform in ["x", "xiaohongshu"]:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"
        
        authorization_url = f"{config['authorize_url']}?{urlencode(params)}"
        
        return {
            "authorization_url": authorization_url,
            "state": state
        }
    
    def handle_callback(self, platform: str, code: str, state: str) -> Dict[str, Any]:
        """
        处理OAuth回调，用授权码换取访问令牌
        
        Args:
            platform: 平台ID
            code: 授权码
            state: 状态码
            
        Returns:
            包含访问令牌和用户信息的字典
        """
        # 验证state
        if state not in self.pending_states:
            raise ValueError("Invalid or expired state")
        
        state_data = self.pending_states.pop(state)
        
        # 检查state是否过期（5分钟）
        if datetime.now() - state_data["timestamp"] > timedelta(minutes=5):
            raise ValueError("State expired")
        
        # 验证platform匹配
        if state_data["platform"] != platform:
            raise ValueError("Platform mismatch")
        
        config = self.OAUTH_CONFIGS.get(platform)
        if not config:
            raise ValueError(f"Platform {platform} not supported")
        
        # 准备token请求参数
        token_params = {
            "client_id": config.get("client_id") or config.get("client_key"),
            "client_secret": config.get("client_secret"),
            "code": code,
            "redirect_uri": f"{config['redirect_uri']}?platform={platform}",
            "grant_type": "authorization_code"
        }
        
        # 添加PKCE verifier（如果需要）
        if platform in ["x", "xiaohongshu"]:
            token_params["code_verifier"] = state_data["code_verifier"]
        
        # 请求访问令牌
        response = requests.post(
            config["token_url"],
            data=token_params,
            headers={"Accept": "application/json"}
        )
        
        if response.status_code != 200:
            raise ValueError(f"Failed to get access token: {response.text}")
        
        token_data = response.json()
        
        # 获取用户信息
        user_info = self._get_user_info(platform, token_data.get("access_token"))
        
        return {
            "success": True,
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in"),
            "account": user_info
        }
    
    def _get_user_info(self, platform: str, access_token: str) -> Dict[str, Any]:
        """
        获取用户信息
        
        Args:
            platform: 平台ID
            access_token: 访问令牌
            
        Returns:
            用户信息字典
        """
        user_api_urls = {
            "github": "https://api.github.com/user",
            "google": "https://www.googleapis.com/oauth2/v2/userinfo",
            "weibo": "https://api.weibo.com/2/users/show.json",
            "xiaohongshu": "https://edith.xiaohongshu.com/api/v1/user/info",
            "douyin": "https://open.douyin.com/oauth/userinfo",
            "x": "https://api.twitter.com/2/users/me",
        }
        
        api_url = user_api_urls.get(platform)
        if not api_url:
            return {"username": "未知用户"}
        
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # GitHub需要特殊的Accept header
        if platform == "github":
            headers["Accept"] = "application/vnd.github.v3+json"
        
        try:
            response = requests.get(api_url, headers=headers)
            if response.status_code == 200:
                data = response.json()
                
                # 根据不同平台提取用户信息
                if platform == "github":
                    return {
                        "username": data.get("login"),
                        "name": data.get("name") or data.get("login"),
                        "avatar": data.get("avatar_url"),
                        "followers": data.get("followers"),
                        "user_id": data.get("id")
                    }
                elif platform == "google":
                    return {
                        "username": data.get("email"),
                        "name": data.get("name"),
                        "avatar": data.get("picture"),
                        "user_id": data.get("id")
                    }
                elif platform == "weibo":
                    return {
                        "username": data.get("screen_name"),
                        "name": data.get("name"),
                        "avatar": data.get("avatar_large"),
                        "followers": data.get("followers_count"),
                        "user_id": data.get("id")
                    }
                elif platform == "xiaohongshu":
                    return {
                        "username": data.get("nickname"),
                        "name": data.get("nickname"),
                        "avatar": data.get("avatar"),
                        "user_id": data.get("user_id")
                    }
                elif platform == "x":
                    user_data = data.get("data", {})
                    return {
                        "username": user_data.get("username"),
                        "name": user_data.get("name"),
                        "user_id": user_data.get("id")
                    }
                
        except Exception as e:
            print(f"Failed to get user info: {e}")
        
        return {"username": "未知用户"}
    
    def refresh_access_token(self, platform: str, refresh_token: str) -> Dict[str, Any]:
        """
        刷新访问令牌
        
        Args:
            platform: 平台ID
            refresh_token: 刷新令牌
            
        Returns:
            新的访问令牌信息
        """
        config = self.OAUTH_CONFIGS.get(platform)
        if not config:
            raise ValueError(f"Platform {platform} not supported")
        
        token_params = {
            "client_id": config.get("client_id") or config.get("client_key"),
            "client_secret": config.get("client_secret"),
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }
        
        response = requests.post(
            config["token_url"],
            data=token_params,
            headers={"Accept": "application/json"}
        )
        
        if response.status_code != 200:
            raise ValueError(f"Failed to refresh token: {response.text}")
        
        token_data = response.json()
        
        return {
            "access_token": token_data.get("access_token"),
            "refresh_token": token_data.get("refresh_token"),
            "expires_in": token_data.get("expires_in")
        }


# 全局实例
oauth_manager = OAuthManager()

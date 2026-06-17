"""
Connector Manager
管理所有平台的连接器
"""

import json
import os
import asyncio
import logging
from typing import Dict, Any, List, Optional
from .base import BaseConnector, ConnectorStatus, PublishResult

logger = logging.getLogger(__name__)
from .bilibili import BilibiliConnector
from .douyin import DouyinConnector
from .xiaohongshu import XiaohongshuConnector
from .kuaishou import KuaishouConnector
from .video_channel import VideoChannelConnector
from .tiktok import TikTokConnector
from .twitter import TwitterConnector
from .youtube import YouTubeConnector
from .weibo import WeiboConnector
from .feishu import FeishuConnector
from .discord_bot import DiscordBotConnector
from .semi_auto_im import SemiAutoIMConnector
from .mock import MockConnector


class ConnectorManager:
    """
    连接器管理器
    负责：
    1. 管理所有平台的连接器实例
    2. 加载和保存凭证
    3. 提供统一的发布接口
    """
    
    # 凭证存储文件 - 优先使用环境变量指定的原始目录
    _project_root = os.environ.get("ORIGINAL_PROJECT_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    CREDENTIALS_FILE = os.path.join(_project_root, "storage/outputs", "credentials_store.json")
    
    # 支持的平台配置
    PLATFORMS = {
        # 🟢 推荐：容易申请OAuth
        'github': {
            'class': MockConnector,
            'name': 'GitHub',
            'supports_real_api': False,
            'supports_oauth': True  # OAuth超简单，5分钟搞定
        },
        'youtube': {
            'class': YouTubeConnector,
            'name': 'YouTube',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'twitter': {
            'class': TwitterConnector,
            'name': 'Twitter (X)',
            'supports_real_api': True,
            'supports_oauth': False
        },
        
        # 🔴 困难或不支持OAuth
        'bilibili': {
            'class': BilibiliConnector,
            'name': '哔哩哔哩',
            'supports_real_api': True,
            'supports_oauth': False  # B站不支持OAuth，使用Cookie
        },
        'xiaohongshu': {
            'class': XiaohongshuConnector,
            'name': '小红书',
            'supports_real_api': True,
            'supports_oauth': False  # 需要企业资质，个人难申请
        },
        'douyin': {
            'class': DouyinConnector,
            'name': '抖音',
            'supports_real_api': True,
            'supports_oauth': False  # 需要企业认证
        },
        'kuaishou': {
            'class': KuaishouConnector,
            'name': '快手',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'video_channel': {
            'class': VideoChannelConnector,
            'name': '视频号',
            'supports_real_api': True,
            'supports_oauth': False  # 使用扫码登录
        },
        'tiktok': {
            'class': TikTokConnector,
            'name': 'TikTok',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'weibo': {
            'class': WeiboConnector,
            'name': '微博',
            'supports_real_api': True,
            'supports_oauth': False  # 审核较严
        },
        'feishu': {
            'class': FeishuConnector,
            'name': '飞书 / Lark',
            'supports_real_api': True,
            'supports_oauth': True
        },
        'discord': {
            'class': DiscordBotConnector,
            'name': 'Discord',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'wechat': {
            'class': SemiAutoIMConnector,
            'name': '微信',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'qq': {
            'class': SemiAutoIMConnector,
            'name': 'QQ',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'dingtalk': {
            'class': SemiAutoIMConnector,
            'name': '钉钉',
            'supports_real_api': True,
            'supports_oauth': False
        },
        'meta': {
            'class': MockConnector,
            'name': 'Meta',
            'supports_real_api': False,
            'supports_oauth': True  # 支持OAuth但需要审核
        }
    }
    
    def __init__(self):
        self.connectors: Dict[str, BaseConnector] = {}
        self._load_credentials()
        self._initialize_connectors()
    
    def _load_credentials(self) -> Dict[str, Any]:
        """从文件加载凭证"""
        if os.path.exists(self.CREDENTIALS_FILE):
            try:
                with open(self.CREDENTIALS_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Failed to load credentials: {e}")
                return {}
        return {}
    
    def _save_credentials(self, credentials: Dict[str, Any]) -> bool:
        """保存凭证到文件"""
        try:
            # 确保目录存在
            os.makedirs(os.path.dirname(self.CREDENTIALS_FILE), exist_ok=True)
            with open(self.CREDENTIALS_FILE, 'w', encoding='utf-8') as f:
                json.dump(credentials, f, ensure_ascii=False, indent=2)
            logger.info(f"Credentials saved successfully to {self.CREDENTIALS_FILE}")
            return True
        except Exception as e:
            logger.error(f"CRITICAL: Failed to save credentials to {self.CREDENTIALS_FILE}: {e}")
            return False
    
    def _initialize_connectors(self):
        """初始化所有平台的连接器"""
        credentials = self._load_credentials()
        
        for platform_id, config in self.PLATFORMS.items():
            platform_creds = credentials.get(platform_id, {})
            
            # 创建连接器实例
            if config['supports_real_api']:
                connector = config['class'](platform_id, platform_creds)
            else:
                connector = config['class'](platform_id, config['name'], platform_creds)
            
            self.connectors[platform_id] = connector
    
    async def initialize_all(self):
        """异步初始化所有已保存凭证的平台"""
        logger.info("Initializing all platform connectors with saved credentials...")
        tasks = []
        for platform_id, connector in self.connectors.items():
            if connector.validate_credentials():
                logger.debug(f"Queuing initialization for {platform_id}")
                tasks.append(connector.initialize())
        
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for platform_id, result in zip([pid for pid, c in self.connectors.items() if c.validate_credentials()], results):
                if isinstance(result, Exception):
                    logger.error(f"Failed to initialize connector for {platform_id}: {result}")
                elif result:
                    logger.info(f"Successfully restored connection for {platform_id}")
                else:
                    logger.warning(f"Failed to restore connection for {platform_id} (credentials might be expired)")
        else:
            logger.info("No saved credentials found to initialize.")

    async def connect_platform(self, platform_id: str, credentials: Dict[str, Any]) -> bool:
        """
        连接平台
        
        Args:
            platform_id: 平台ID
            credentials: 认证凭据
            
        Returns:
            bool: 是否连接成功
        """
        if platform_id not in self.connectors:
            return False
        
        connector = self.connectors[platform_id]
        connector.update_credentials(credentials)
        
        # 尝试初始化连接
        success = await connector.initialize()
        
        if success:
            # 保存凭证
            all_credentials = self._load_credentials()
            all_credentials[platform_id] = credentials
            if not self._save_credentials(all_credentials):
                print(f"Warning: credentials for {platform_id} updated in memory but failed to save to disk.")
        
        return success
    
    async def disconnect_platform(self, platform_id: str) -> bool:
        """
        断开平台连接
        删除保存的凭证
        """
        if platform_id not in self.connectors:
            return False
        
        # 清除凭证
        all_credentials = self._load_credentials()
        if platform_id in all_credentials:
            del all_credentials[platform_id]
            self._save_credentials(all_credentials)
        
        # 重置连接器
        connector = self.connectors[platform_id]
        connector.update_credentials({})
        # Ensure it reflects correctly in UI
        connector.status = ConnectorStatus.DISCONNECTED
        
        return True
    
    async def publish_to_platform(
        self,
        platform_id: str,
        content_type: str,
        title: str,
        content: str,
        media_urls: List[str] = None,
        options: Dict[str, Any] = None
    ) -> PublishResult:
        """
        发布内容到指定平台
        """
        if platform_id not in self.connectors:
            return PublishResult(
                success=False,
                platform=platform_id,
                error=f"不支持的平台: {platform_id}"
            )
        
        connector = self.connectors[platform_id]
        
        # Force reload credentials to ensure we have the latest (e.g. just logged in via interactive login)
        current_creds = self._load_credentials()
        platform_creds = current_creds.get(platform_id, {})
        connector.update_credentials(platform_creds)
        
        # 检查连接状态
        if not connector.is_connected():
            # 尝试重新连接
            if not await connector.initialize():
                return PublishResult(
                    success=False,
                    platform=platform_id,
                    error="平台未连接或认证已过期，请重新登录"
                )
        
        # 发布内容
        return await connector.publish_content(
            content_type=content_type,
            title=title,
            content=content,
            media_urls=media_urls,
            options=options
        )
    
    async def publish_to_all_platforms(
        self,
        content_type: str,
        title: str,
        content: str,
        media_urls: List[str] = None,
        options: Dict[str, Any] = None
    ) -> List[PublishResult]:
        """
        一键发布到所有已连接的平台
        """
        tasks = []
        for platform_id, connector in self.connectors.items():
            # 只发布到已连接（有凭证）的平台
            if connector.is_connected() or connector.validate_credentials():
                 print(f"Adding task for {platform_id}")
                 tasks.append(
                     self.publish_to_platform(
                         platform_id, content_type, title, content, media_urls, options
                     )
                 )
        
        if not tasks:
            return []
            
        return await asyncio.gather(*tasks, return_exceptions=True)
    
    def get_all_platforms(self) -> List[Dict[str, Any]]:
        """获取所有平台状态"""
        result = []
        for platform_id, connector in self.connectors.items():
            config = self.PLATFORMS[platform_id]
            result.append({
                'platform_id': platform_id,
                'platform_name': config['name'],
                'supports_real_api': config['supports_real_api'],
                'supports_oauth': config.get('supports_oauth', False),
                'status': connector.status.value,
                'connected': connector.is_connected(),
                'account_info': connector.account_info,
                'required_fields': connector.required_credentials,
                'has_credentials': connector.validate_credentials()
            })
        return result
    
    def get_platform_status(self, platform_id: str) -> Optional[Dict[str, Any]]:
        """获取单个平台状态"""
        if platform_id not in self.connectors:
            return None
        
        connector = self.connectors[platform_id]
        config = self.PLATFORMS[platform_id]
        
        return {
            'platform_id': platform_id,
            'platform_name': config['name'],
            'supports_real_api': config['supports_real_api'],
            'supports_oauth': config.get('supports_oauth', False),
            'status': connector.status.value,
            'connected': connector.is_connected(),
            'account_info': connector.account_info,
            'required_fields': connector.required_credentials,
            'has_credentials': connector.validate_credentials()
        }

    async def execute_platform_action(self, platform_id: str, action_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行平台动作矩阵中的原子动作。"""
        if platform_id not in self.connectors:
            return {
                "success": False,
                "status": "unsupported_platform",
                "platform": platform_id,
                "error": f"不支持的平台: {platform_id}",
            }

        connector = self.connectors[platform_id]
        current_creds = self._load_credentials()
        connector.update_credentials(current_creds.get(platform_id, connector.credentials or {}))
        if not connector.validate_credentials():
            return {
                "success": False,
                "status": "missing_credentials",
                "platform": platform_id,
                "action_id": action_id,
                "required_fields": connector.required_credentials,
                "error": "平台未配置凭证",
            }

        if not connector.is_connected():
            initialized = await connector.initialize()
            if not initialized:
                return {
                    "success": False,
                    "status": "not_connected",
                    "platform": platform_id,
                    "action_id": action_id,
                    "error": "平台未连接或认证已过期，请重新登录",
                }

        action_runner = getattr(connector, "execute_action", None)
        if not callable(action_runner):
            return {
                "success": False,
                "status": "action_not_implemented",
                "platform": platform_id,
                "action_id": action_id,
                "error": "该平台 connector 尚未实现动作执行入口",
            }
        return await action_runner(action_id, params or {})


# 全局实例
_manager_instance = None

def get_connector_manager() -> ConnectorManager:
    """获取连接器管理器单例"""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = ConnectorManager()
    return _manager_instance

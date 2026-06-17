"""
交互式浏览器登录管理器
打开可见浏览器窗口，用户手动登录，然后抓取 Cookie
"""

import asyncio
import json
import logging
import os
import time
from typing import Dict, Optional, Any
from pathlib import Path

# 设置浏览器路径 (项目根目录下的 .browsers；桌面包由 Electron 注入 PLAYWRIGHT_BROWSERS_PATH)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
BROWSER_PATH = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or (PROJECT_ROOT / ".browsers"))
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(BROWSER_PATH)

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext
except ImportError:
    async_playwright = None

logger = logging.getLogger(__name__)


class InteractiveBrowserLogin:
    """
    交互式浏览器登录
    打开可见浏览器，用户手动登录，完成后抓取 Cookie
    """
    
    def __init__(self):
        self.playwright = None
        self.active_sessions: Dict[str, dict] = {}  # session_id -> {context, page, platform}
        
        # 各平台的登录配置
        self.platform_config = {
            "douyin": {
                "login_url": "https://creator.douyin.com/",
                "success_indicators": ["creator.douyin.com/creator", "douyin.com/user"],
                "login_cookie": "sessionid",  # 登录后会有这个cookie
                "wait_text": "请在浏览器中完成抖音登录（扫码或密码均可）",
            },
            "xiaohongshu": {
                "login_url": "https://creator.xiaohongshu.com/",
                "success_indicators": [
                    "creator.xiaohongshu.com/creator", 
                    "xiaohongshu.com/user", 
                    "creator.xiaohongshu.com/publish",
                    "creator.xiaohongshu.com/manage",
                    "creator.xiaohongshu.com/new-creator",
                    "creator.xiaohongshu.com/new/home"
                ],
                "login_cookie": "web_session",      # 传统Cookie
                "alt_login_cookies": ["customer-sso-sid", "x-s-s-sid"], # 新版Cookie
                "wait_text": "请在浏览器中完成小红书登录",
            },
            "bilibili": {
                "login_url": "https://passport.bilibili.com/login",
                "success_indicators": ["www.bilibili.com", "space.bilibili.com", "member.bilibili.com", "bilibili.com/?spm"],
                "login_cookie": "SESSDATA",  # B站登录的关键cookie
                "wait_text": "请在浏览器中完成B站登录",
            },
            "weibo": {
                "login_url": "https://passport.weibo.com/sso/signin",
                "success_indicators": ["weibo.com/u/", "weibo.com/home", "weibo.com/mygroups"],
                "login_cookie": "SUB",
                "wait_text": "请在浏览器中完成微博登录",
            },
            "twitter": {
                "login_url": "https://x.com/login",
                "success_indicators": ["x.com/home", "twitter.com/home"],
                "login_cookie": "auth_token",
                "wait_text": "请在浏览器中完成 Twitter (X) 登录",
            },
            "youtube": {
                "login_url": "https://studio.youtube.com/",
                "success_indicators": ["studio.youtube.com", "youtube.com/upload"],
                "login_cookie": "LOGIN_INFO",
                "wait_text": "请在浏览器中完成 YouTube 登录",
            },
            "tiktok": {
                "login_url": "https://www.tiktok.com/login",
                "success_indicators": ["tiktok.com/creator-center", "tiktok.com/foryou"],
                "login_cookie": "sessionid",
                "wait_text": "请在浏览器中完成 TikTok 登录",
            },
            "video_channel": {
                "login_url": "https://channels.weixin.qq.com/",
                "success_indicators": ["channels.weixin.qq.com/platform"],
                "login_cookie": "sessionid",
                "wait_text": "请在浏览器中完成视频号登录",
            },
            "kuaishou": {
                "login_url": "https://passport.kuaishou.com/pc/account/login",
                "success_indicators": ["cp.kuaishou.com"], # 仅当进入创作者后台才视为 URL 匹配
                "login_cookie": "kuaishou.web.api_st", 
                "alt_login_cookies": ["kuaishou.server.web_st", "kuaishou.server.web_ph", "passToken"],
                "wait_text": "请在浏览器中完成快手登录",
            },
        }

    async def _ensure_playwright(self):
        """确保 Playwright 已启动"""
        if not async_playwright:
            raise ImportError("Playwright 未安装。请运行: pip install playwright && playwright install chromium")
        
        if not self.playwright:
            # Ensure local storage/temp exists
            project_root = Path(__file__).parent.parent.parent.parent
            (project_root / "storage" / "tmp").mkdir(parents=True, exist_ok=True)
            
            self.playwright = await async_playwright().start()

    async def start_interactive_login(self, platform: str) -> Dict[str, Any]:
        """
        启动交互式登录
        打开可见浏览器窗口，返回 session_id 供前端轮询
        """
        if platform not in self.platform_config:
            return {"success": False, "error": f"不支持的平台: {platform}"}
        
        config = self.platform_config[platform]
        
        try:
            await self._ensure_playwright()
            
            # 启动可见的浏览器（headless=False）
            logger.info(f"[{platform}] 启动可见浏览器...")
            
            # 启动持久化上下文 (使用项目内的 storage 目录)
            user_data_dir = os.path.join(PROJECT_ROOT, "storage", "profiles", f"chrome_profile_{platform}")
            # removed shutil.rmtree to persist login info across interactive login sessions
            os.makedirs(user_data_dir, exist_ok=True)
            
            logger.info(f"[{platform}] 启动可见浏览器 (Profile: {user_data_dir})...")
            
            context = await self.playwright.chromium.launch_persistent_context(
                user_data_dir,
                headless=False,  # 可见！
                args=['--no-sandbox', '--disable-blink-features=AutomationControlled'],
                viewport={"width": 1280, "height": 800},
                locale="zh-CN"
            )

            # Add stealth script
            stealth_path = Path(__file__).parent / "stealth.min.js"
            if stealth_path.exists():
                await context.add_init_script(path=stealth_path)
            
            page = context.pages[0] if context.pages else await context.new_page()
            browser = None # persistent context works as browser
            
            # 导航到登录页
            logger.info(f"[{platform}] 打开登录页: {config['login_url']}")
            await page.goto(config["login_url"])
            
            # 生成 session ID
            session_id = f"{platform}_{int(time.time())}"
            
            # 保存会话信息
            self.active_sessions[session_id] = {
                "browser": browser,
                "context": context,
                "page": page,
                "platform": platform,
                "config": config,
                "start_time": time.time(),
                "status": "waiting"  # waiting, success, timeout, error
            }
            
            logger.info(f"[{platform}] 浏览器已打开，等待用户登录... session: {session_id}")
            
            return {
                "success": True,
                "session_id": session_id,
                "message": config["wait_text"],
                "status": "waiting"
            }
            
        except Exception as e:
            logger.error(f"[{platform}] 启动浏览器失败: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}

    async def check_login_status(self, session_id: str) -> Dict[str, Any]:
        """
        检查登录状态
        前端轮询此接口，检测用户是否已完成登录
        """
        if session_id not in self.active_sessions:
            logger.warning(f"会话不存在: {session_id}")
            return {"status": "expired", "error": "会话不存在或已过期"}
        
        session = self.active_sessions[session_id]
        page = session["page"]
        context = session["context"]
        config = session["config"]
        platform = session["platform"]
        
        try:
            # 检查浏览器是否还开着
            try:
                if page.is_closed():
                    del self.active_sessions[session_id]
                    return {"status": "cancelled", "message": "浏览器已关闭"}
            except:
                del self.active_sessions[session_id]
                return {"status": "cancelled", "message": "浏览器已关闭"}
            
            # 获取当前 URL 和 Cookies
            current_url = page.url
            
            # 如果匹配了 URL 指示器，稍微等 1 秒让 Cookie 彻底同步
            url_matched_initially = False
            for indicator in config.get("success_indicators", []):
                if indicator and indicator in current_url:
                    url_matched_initially = True
                    break
            
            if url_matched_initially:
                await asyncio.sleep(2)
                current_url = page.url # 刷新一次 URL
            
            cookies = await context.cookies()
            cookie_names = [c['name'] for c in cookies]
            
            # 详细日志记录
            logger.info(f"[{platform}] 正在检查状态: {current_url}")
            logger.info(f"[{platform}] 检测到的所有 Cookie: {', '.join(cookie_names)}")
            
            # 方法1: 检查是否有登录 cookie
            login_cookie = config.get("login_cookie")
            alt_cookies = config.get("alt_login_cookies", [])
            
            has_login_cookie = (login_cookie and login_cookie in cookie_names)
            if not has_login_cookie:
                # 检查备选 Cookie
                for alt_c in alt_cookies:
                    if alt_c in cookie_names:
                        has_login_cookie = True
                        logger.info(f"[{platform}] ✅ 检测到备选登录 Cookie: {alt_c}")
                        break
            
            if has_login_cookie:
                logger.info(f"[{platform}] ✅ 核实成功：已获取到登录会话 Cookie")
            
            # 方法2: 检查 URL 是否匹配成功指示器
            url_matched = False
            for indicator in config.get("success_indicators", []):
                if indicator and indicator in current_url:
                    url_matched = True
                    logger.info(f"[{platform}] ✅ 触发 URL 匹配成功: {indicator}")
                    break
            
            # 判断登录成功的条件：
            # 1. 必须有登录cookie 
            # 2. 或者在小红书新版页面，如果有 customer-sso-sid 且 URL 匹配也算成功
            
            login_success = False
            if has_login_cookie:
                login_success = True
            elif url_matched and platform == "xiaohongshu" and ("customer-sso-sid" in cookie_names or len(cookies) > 15):
                # 小红书特殊逻辑
                login_success = True
                logger.info(f"[{platform}] ✅ URL 匹配且 Cookie 充足，判定登录成功")
            elif url_matched and platform == "kuaishou":
                # Kuaishou logic: URL match is strong indicator. 
                # If we have URL match and enough cookies, we assume success even if specific keys are missed/renamed.
                if len(cookies) > 5:
                    logger.info(f"[{platform}] URL 已匹配且检测到 {len(cookies)} 个 Cookie，判定登录成功")
                    login_success = True
                else:
                    logger.info(f"[{platform}] URL 已匹配，但 Cookie 数量不足 ({len(cookies)})，继续等待...")
                    login_success = False
            elif url_matched and platform != "xiaohongshu":
                login_success = True
            elif url_matched:
                logger.warning(f"[{platform}] ⚠️ URL 已匹配但在检测登录凭证（Cookies）中，继续等待...")
            
            if login_success:
                print(f"[{platform}] 🎉 确认登录成功！Cookie: {has_login_cookie}, URL: {url_matched}")
                logger.info(f"[{platform}] 检测到登录成功！")
                
                # 抓取所有 Cookies
                cookie_string = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
                
                # 异步关闭，不要阻塞返回结果
                async def silent_close():
                    try:
                        if session.get("browser"):
                            await session["browser"].close()
                        elif session.get("context"):
                             await session["context"].close()
                        logger.info(f"[{platform}] 浏览器已关闭")
                    except:
                        pass
                
                asyncio.create_task(silent_close())
                del self.active_sessions[session_id]
                
                return {
                    "status": "success",
                    "message": "登录成功！",
                    "cookies": cookie_string,
                    "platform": platform
                }
            
            # 检查超时（5分钟）
            elapsed = time.time() - session["start_time"]
            if elapsed > 300:
                try:
                    if session.get("browser"):
                        await session["browser"].close()
                    elif session.get("context"):
                         await session["context"].close()
                except: pass
                del self.active_sessions[session_id]
                return {"status": "timeout", "error": "登录超时，请重试"}
            
            # 仍在等待
            return {
                "status": "waiting",
                "message": config["wait_text"],
                "elapsed": int(elapsed)
            }
            
        except Exception as e:
            logger.error(f"检查登录状态失败: {e}")
            return {"status": "error", "error": str(e)}

    async def cancel_login(self, session_id: str) -> Dict[str, Any]:
        """取消登录，关闭浏览器"""
        if session_id in self.active_sessions:
            session = self.active_sessions[session_id]
            try:
                if session.get("browser"):
                    await session["browser"].close()
                elif session.get("context"):
                     await session["context"].close()
            except:
                pass
            del self.active_sessions[session_id]
            return {"success": True, "message": "已取消"}
        return {"success": True, "message": "会话不存在"}

    async def close(self):
        """关闭所有会话"""
        for session_id, session in list(self.active_sessions.items()):
            try:
                if session.get("browser"):
                    await session["browser"].close()
                elif session.get("context"):
                     await session["context"].close()
            except:
                pass
        self.active_sessions.clear()
        
        if self.playwright:
            await self.playwright.stop()


# 全局实例
interactive_login_manager = InteractiveBrowserLogin()

"""
无头浏览器模拟登录管理器
使用 Playwright 自动化登录各平台，获取 Session/Cookie
"""

import asyncio
import base64
import json
import logging
import os
import time
from typing import Dict, Optional, Any
from pathlib import Path

# 设置浏览器路径 (桌面包由 Electron 注入 PLAYWRIGHT_BROWSERS_PATH)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
BROWSER_PATH = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or (PROJECT_ROOT / ".browsers"))
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(BROWSER_PATH)

try:
    from playwright.async_api import async_playwright, Page, Browser, BrowserContext
except ImportError:
    async_playwright = None

logger = logging.getLogger(__name__)


class HeadlessBrowserLogin:
    """
    无头浏览器登录管理器
    支持账号密码自动填写登录，以及扫码登录
    """
    
    def __init__(self):
        self.browser: Optional[Browser] = None
        self.playwright = None
        self._lock = asyncio.Lock()
        
        # 各平台的登录配置 - 根据实际页面结构
        self.platform_config = {
            "douyin": {
                "login_url": "https://www.douyin.com/",
                "needs_login_button": True,  # 需要先点击登录按钮弹窗
                "login_button_selector": "button:has-text('登录'), .login-guide-container, [data-e2e='header-login-btn']",
                "password_tab_selector": "text=密码登录",
                "username_selector": "input[placeholder*='手机号'], input[placeholder*='请输入手机号']",
                "password_selector": "input[placeholder*='密码'], input[type='password']",
                "submit_selector": "button:has-text('登录'), button:has-text('登录/注册'), .login-button",
                "success_indicator": "douyin.com",
            },
            "xiaohongshu": {
                "login_url": "https://www.xiaohongshu.com/explore",
                "needs_login_button": True,
                "login_button_selector": "text=登录, .login-btn",
                "password_tab_selector": "text=密码登录",
                "username_selector": "input[placeholder*='手机号']",
                "password_selector": "input[type='password']",
                "submit_selector": "button:has-text('登录')",
                "success_indicator": "xiaohongshu.com",
            },
            "bilibili": {
                "login_url": "https://passport.bilibili.com/login",
                "needs_login_button": False,  # 直接显示表单
                "password_tab_selector": "text=密码登录",  # 可能需要切换
                "username_selector": "input[placeholder='请输入账号']",
                "password_selector": "input[placeholder='请输入密码']",
                "submit_selector": ".btn_primary, div.btn_primary",  # 这是个div不是button
                "success_indicator": "bilibili.com",
            },
            "weibo": {
                "login_url": "https://passport.weibo.com/sso/signin",
                "needs_login_button": False,
                "password_tab_selector": "text=密码登录",
                "username_selector": "input[name='username'], input[placeholder*='邮箱'], input[placeholder*='手机']",
                "password_selector": "input[name='password'], input[type='password']",
                "submit_selector": "button:has-text('登录'), input[type='submit']",
                "success_indicator": "weibo.com",
            },
        }

    async def _ensure_browser(self) -> Browser:
        """确保浏览器已启动"""
        if not async_playwright:
            raise ImportError(
                "Playwright 未安装。请运行: pip install playwright && playwright install chromium"
            )
        
        async with self._lock:
            if not self.playwright:
                self.playwright = await async_playwright().start()
                
            if not self.browser or not self.browser.is_connected():
                logger.info("启动 Chromium 浏览器...")
                # Ensure local storage/temp exists for internal operations
                project_root = Path(__file__).parent.parent.parent.parent
                (project_root / "storage" / "tmp").mkdir(parents=True, exist_ok=True)
                
                self.browser = await self.playwright.chromium.launch(
                    headless=True,
                    args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
                )
                
        return self.browser

    async def login_with_credentials(
        self, 
        platform: str, 
        username: str, 
        password: str
    ) -> Dict[str, Any]:
        """
        使用账号密码登录
        
        Args:
            platform: 平台ID (douyin, xiaohongshu, bilibili, weibo)
            username: 用户名/手机号
            password: 密码
            
        Returns:
            {"success": True, "cookies": {...}, "message": "..."}
            or {"success": False, "error": "..."}
        """
        if platform not in self.platform_config:
            return {"success": False, "error": f"不支持的平台: {platform}"}
        
        config = self.platform_config[platform]
        logger.info(f"[{platform}] 开始无头浏览器登录...")
        
        try:
            browser = await self._ensure_browser()
            
            # 创建新的浏览器上下文（模拟普通用户）
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 720},
                locale="zh-CN"
            )
            page = await context.new_page()
            
            # 导航到登录页面
            logger.info(f"[{platform}] 访问登录页: {config['login_url']}")
            await page.goto(config["login_url"], wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(3)  # 等待页面稳定
            
            # 保存初始截图用于调试
            debug_dir = Path(__file__).parent.parent.parent / "debug_screenshots"
            debug_dir.mkdir(exist_ok=True)
            initial_screenshot = await page.screenshot()
            screenshot_path = debug_dir / f"{platform}_initial_{int(time.time())}.png"
            with open(screenshot_path, "wb") as f:
                f.write(initial_screenshot)
            logger.info(f"[{platform}] 初始截图已保存: {screenshot_path}")
            
            # 如果需要先点击"登录"按钮来打开登录弹窗
            if config.get("needs_login_button"):
                logger.info(f"[{platform}] 需要先点击登录按钮...")
                try:
                    login_btn = await page.wait_for_selector(
                        config["login_button_selector"], 
                        timeout=5000
                    )
                    if login_btn:
                        await login_btn.click()
                        await asyncio.sleep(2)
                        logger.info(f"[{platform}] 已点击登录按钮，等待弹窗...")
                except Exception as e:
                    logger.warning(f"点击登录按钮失败: {e}")
            
            # 尝试切换到密码登录模式（如果需要）
            password_tab_selector = config.get("password_tab_selector")
            if password_tab_selector:
                try:
                    password_tab = await page.wait_for_selector(password_tab_selector, timeout=3000)
                    if password_tab:
                        logger.info(f"[{platform}] 切换到密码登录模式")
                        await password_tab.click()
                        await asyncio.sleep(1)
                except Exception as e:
                    logger.debug(f"切换登录模式失败（可能已经是密码模式）: {e}")
            
            # 智能查找用户名输入框
            logger.info(f"[{platform}] 查找用户名输入框...")
            username_input = None
            for selector in config["username_selector"].split(", "):
                try:
                    username_input = await page.wait_for_selector(selector.strip(), timeout=3000)
                    if username_input:
                        logger.info(f"[{platform}] 找到用户名输入框: {selector}")
                        break
                except:
                    continue
            
            if not username_input:
                # 尝试通用选择器
                try:
                    username_input = await page.wait_for_selector("input[type='text'], input[type='tel']", timeout=5000)
                except:
                    pass
            
            if not username_input:
                after_screenshot = await page.screenshot()
                after_path = debug_dir / f"{platform}_no_username_{int(time.time())}.png"
                with open(after_path, "wb") as f:
                    f.write(after_screenshot)
                return {
                    "success": False,
                    "error": f"找不到用户名输入框。请检查平台登录页是否有变化。调试截图: {after_path}",
                    "screenshot": base64.b64encode(after_screenshot).decode('utf-8')
                }
            
            await username_input.click()
            await username_input.fill(username)
            await asyncio.sleep(0.5)
            
            # 智能查找密码输入框
            logger.info(f"[{platform}] 查找密码输入框...")
            password_input = None
            for selector in config["password_selector"].split(", "):
                try:
                    password_input = await page.query_selector(selector.strip())
                    if password_input:
                        logger.info(f"[{platform}] 找到密码输入框: {selector}")
                        break
                except:
                    continue
            
            if not password_input:
                try:
                    password_input = await page.wait_for_selector("input[type='password']", timeout=5000)
                except:
                    pass
            
            if not password_input:
                return {"success": False, "error": "找不到密码输入框"}
            
            await password_input.click()
            await password_input.fill(password)
            await asyncio.sleep(0.5)
            
            # 填写后截图
            filled_screenshot = await page.screenshot()
            filled_path = debug_dir / f"{platform}_filled_{int(time.time())}.png"
            with open(filled_path, "wb") as f:
                f.write(filled_screenshot)
            logger.info(f"[{platform}] 填写后截图已保存: {filled_path}")
            
            # 智能查找登录按钮
            logger.info(f"[{platform}] 查找登录按钮...")
            submit_btn = None
            for selector in config["submit_selector"].split(", "):
                try:
                    submit_btn = await page.query_selector(selector.strip())
                    if submit_btn:
                        # 确保元素可见
                        is_visible = await submit_btn.is_visible()
                        if is_visible:
                            logger.info(f"[{platform}] 找到登录按钮: {selector}")
                            break
                        else:
                            submit_btn = None
                except Exception as e:
                    logger.debug(f"选择器 {selector} 未找到: {e}")
                    continue
            
            if not submit_btn:
                # 尝试用 Playwright locator 方式查找
                try:
                    locator = page.get_by_role("button", name="登录")
                    if await locator.count() > 0:
                        submit_btn = await locator.first.element_handle()
                        logger.info(f"[{platform}] 通过 role 找到登录按钮")
                except:
                    pass
            
            if not submit_btn:
                # 尝试找任何包含"登录"文字的可点击元素
                try:
                    submit_btn = await page.query_selector("div:has-text('登录'), button:has-text('登录')")
                except:
                    pass
            
            if not submit_btn:
                return {
                    "success": False, 
                    "error": "找不到登录按钮",
                    "screenshot": base64.b64encode(filled_screenshot).decode('utf-8')
                }
            
            await submit_btn.click()
            
            # 等待登录完成（检测URL变化或元素出现）
            logger.info(f"[{platform}] 等待登录完成...")
            
            # 等待最多30秒
            success = False
            for i in range(30):
                await asyncio.sleep(1)
                current_url = page.url
                logger.debug(f"当前URL: {current_url}")
                
                if config["success_indicator"] in current_url:
                    success = True
                    break
                    
                # 检查是否有错误提示
                error_element = await page.query_selector(".error-msg, .login-error, .toast-error")
                if error_element:
                    error_text = await error_element.text_content()
                    if error_text:
                        await context.close()
                        return {
                            "success": False, 
                            "error": f"登录失败: {error_text}",
                            "screenshot": base64.b64encode(filled_screenshot).decode('utf-8')
                        }
            
            if not success:
                final_screenshot = await page.screenshot()
                await context.close()
                return {
                    "success": False,
                    "error": "登录超时，请检查账号密码是否正确，或平台可能需要验证码",
                    "screenshot": base64.b64encode(final_screenshot).decode('utf-8')
                }
            
            # 登录成功，提取 Cookies
            logger.info(f"[{platform}] 登录成功！提取 Cookies...")
            cookies = await context.cookies()
            
            # 转换为简单的 dict 格式
            cookie_dict = {c['name']: c['value'] for c in cookies}
            cookie_string = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
            
            # 尝试获取用户信息
            account_info = await self._extract_account_info(page, platform)
            
            await context.close()
            
            return {
                "success": True,
                "cookies": cookie_dict,
                "cookie_string": cookie_string,
                "account_info": account_info,
                "message": "登录成功！"
            }
            
        except Exception as e:
            logger.error(f"[{platform}] 登录过程出错: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "success": False,
                "error": f"登录过程出错: {str(e)}"
            }

    async def _extract_account_info(self, page: Page, platform: str) -> Dict[str, Any]:
        """尝试从页面提取账号信息"""
        try:
            # 通用提取逻辑
            # 这里可以根据不同平台定制
            return {
                "platform": platform,
                "login_time": time.strftime("%Y-%m-%d %H:%M:%S")
            }
        except:
            return {}

    async def get_qr_code(self, platform: str) -> Dict[str, Any]:
        """
        获取平台的登录二维码（用于扫码登录）
        """
        if platform not in self.platform_config:
            return {"success": False, "error": f"不支持的平台: {platform}"}
        
        config = self.platform_config[platform]
        
        try:
            browser = await self._ensure_browser()
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                viewport={"width": 1280, "height": 720}
            )
            page = await context.new_page()
            
            await page.goto(config["login_url"], wait_until="networkidle", timeout=30000)
            await asyncio.sleep(2)
            
            # 尝试找到二维码
            qr_element = await page.query_selector(config.get("qr_selector", "img"))
            
            if qr_element:
                screenshot = await qr_element.screenshot()
                qr_base64 = base64.b64encode(screenshot).decode('utf-8')
                
                # 保存上下文用于后续状态检查
                session_id = f"{platform}_{int(time.time())}"
                
                return {
                    "success": True,
                    "session_id": session_id,
                    "qrcode": f"data:image/png;base64,{qr_base64}"
                }
            else:
                # 截取整个登录区域
                screenshot = await page.screenshot()
                return {
                    "success": True,
                    "session_id": f"{platform}_{int(time.time())}",
                    "qrcode": f"data:image/png;base64,{base64.b64encode(screenshot).decode('utf-8')}"
                }
                
        except Exception as e:
            logger.error(f"获取二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def close(self):
        """关闭浏览器"""
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()


# 全局实例
headless_login_manager = HeadlessBrowserLogin()

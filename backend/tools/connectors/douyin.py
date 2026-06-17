"""
Douyin Connector
抖音平台连接器
"""

import aiohttp
import json
import os
import time
import asyncio
import re
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class DouyinConnector(BaseConnector):
    """
    抖音连接器
    使用 sessionid 进行认证
    """
    
    API_BASE = "https://creator.douyin.com"
    
    @property
    def platform_name(self) -> str:
        return "抖音"
    
    @property
    def required_credentials(self) -> List[str]:
        return ['sessionid']
    
    def _get_headers(self) -> Dict[str, str]:
        cookie_parts = []
        for key, value in self.credentials.items():
            cookie_parts.append(f"{key}={value}")
            
        return {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': '; '.join(cookie_parts),
            'Referer': 'https://creator.douyin.com/creator/content/publish',
            'Origin': 'https://creator.douyin.com'
        }
    
    async def verify_connection(self) -> bool:
        """
        验证抖音登录状态
        尝试调用个人信息接口，判断 sessionid 是否仍然有效
        """
        if 'sessionid' not in self.credentials:
            return False
            
        try:
            async with aiohttp.ClientSession() as session:
                url = "https://creator.douyin.com/web/api/media/v1/user/info/"
                headers = self._get_headers()
                async with session.get(url, headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # status_code 0 usually means success
                        return data.get('base_resp', {}).get('status_code') == 0
                    return False
        except Exception as e:
            print(f"Douyin connection verification error: {e}")
            # 如果请求出错（如网络问题），暂时保留原状态，除非明确返回 401/403
            return 'sessionid' in self.credentials

    async def get_account_info(self) -> Dict[str, Any]:
        """
        获取账号信息
        尝试从API获取，如果失败则返回占位符，不影响连接状态显示
        """
        try:
            async with aiohttp.ClientSession() as session:
                url = "https://creator.douyin.com/web/api/media/v1/user/info/"
                # 设置更完善的 Headers
                headers = self._get_headers()
                
                async with session.get(url, headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get('base_resp', {}).get('status_code') == 0:
                            user_info = data.get('user_info', {})
                            return {
                                "username": user_info.get('nickname', '抖音用户'),
                                "avatar": user_info.get('avatar_url', ''),
                                "uid": user_info.get('unique_id', '')
                            }
            # 如果API失败，返回基本信息（避免UI报错）
            return {
                "username": "抖音用户 (已登录)",
                "avatar": "",
                "uid": self.credentials.get('uid', '')
            }
        except Exception as e:
            print(f"Failed to get douyin account info: {e}")
            return {
                "username": "抖音用户",
                "uid": ""
            }

    def _get_title_from_encrypted(self, title):
        return title

    async def publish_content(
        self, 
        content_type: str = "video", 
        title: str = "", 
        content: Any = "", 
        media_urls: List[str] = None, 
        options: Dict[str, Any] = None,
        **kwargs
    ) -> PublishResult:
        """
        发布内容到抖音 (使用 Playwright 模拟浏览器操作)
        """
        # Handle legacy 'content' dictionary (for test_douyin_v5.py compatibility)
        # Handle legacy 'content' dictionary (for test_douyin_v5.py compatibility)
        if isinstance(content, dict):
            legacy_content = content
            content_type = legacy_content.get("type", content_type)
            video_path = legacy_content.get("video_path")
            desc = legacy_content.get("description", "")
            title = legacy_content.get("title", title)
        elif 'content' in kwargs and isinstance(kwargs['content'], dict):
            legacy_content = kwargs['content']
            content_type = legacy_content.get("type", content_type)
            video_path = legacy_content.get("video_path")
            desc = legacy_content.get("description", str(content))
            title = legacy_content.get("title", title)
        else:
            video_path = media_urls[0] if media_urls else None
            desc = str(content)

        if content_type == "mixed" and media_urls:
            content_type = self._detect_content_type(media_urls)
            print(f"[Douyin] 智能识别 mixed -> {content_type}")

        if content_type != "video":
             return PublishResult(
                success=False,
                platform=self.platform_id,
                error=f"抖音单次发布仅支持视频类型 (video)，不支持 {content_type}。如果是图文内容，请手动在后台发布。"
            )
            
        if not video_path:
            # 尝试从 media_urls 中找
            if media_urls:
                for url in media_urls:
                    if any(ext in url.lower() for ext in ['.mp4', '.mov', '.avi', '.webm']):
                        video_path = url
                        break
            
            if not video_path:
                return PublishResult(
                    success=False,
                    platform=self.platform_id,
                    error="发布视频需要提供媒体URL (video_path)"
                )

        return await self._publish_video(video_path, desc, title, options, **kwargs)

    async def _publish_video(self, video_path: str, desc: str, title: str, options: Dict[str, Any] = None, **kwargs) -> PublishResult:
        """内部视频发布逻辑"""
        cdp_url = (options or {}).get("cdp_url") if options else kwargs.get("cdp_url")

        # 增强路径解析
        root_dir = self.get_project_root()
        filename = os.path.basename(video_path)
        search_paths = [
            video_path, # Original
            os.path.join(root_dir, "storage/uploads", filename),
            os.path.join(root_dir, "storage/outputs", filename),
        ]
        
        final_video_path = None
        for p in search_paths:
            if os.path.exists(p):
                final_video_path = p
                print(f"[Douyin] 找到文件: {p}")
                break
        
        if final_video_path:
            video_path = final_video_path
        else:
             print(f"[Douyin] 警告: Python无法找到视频文件，尝试过的路径: {search_paths}")
             # try to force use the absolute path in standard location anyway
             video_path = os.path.join(root_dir, "storage/uploads", filename)
             print(f"[Douyin] 强制使用路径: {video_path}")

        encrypted_title = title
        formatted_title = self._get_title_from_encrypted(encrypted_title)
        print(f"[Douyin] 启动发布流程: {formatted_title}")
        
        try:
            from playwright.async_api import async_playwright
            import shutil
            
            tmp_dir = os.path.join(root_dir, "storage", "temp")
            os.makedirs(tmp_dir, exist_ok=True)
            print(f"[Douyin] 使用本地临时目录: {tmp_dir}")
            
            # 确保使用正确的浏览器路径
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
            
            # 搜索可能的浏览器路径 (优先使用 headless-shell)
            possible_paths = [
                os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
                os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
            ]
            
            browser_path = None
            for p in possible_paths:
                if os.path.exists(p):
                    browser_path = p
                    print(f"[Douyin] 找到浏览器可执行文件: {p}")
                    break
            
            print(f"[Douyin] Root Dir: {root_dir}")
            print(f"[Douyin] Final Browser Path: {browser_path}")
            print(f"[Douyin] PLAYWRIGHT_BROWSERS_PATH: {os.environ['PLAYWRIGHT_BROWSERS_PATH']}")
            
            # Attempt to copy large video file to temp dir
            temp_video_path = os.path.join(tmp_dir, f"temp_upload_{os.path.basename(video_path)}")
            try:
                print(f"[Douyin] 尝试将视频复制到临时目录: {temp_video_path}")
                with open(video_path, 'rb') as fsrc:
                    with open(temp_video_path, 'wb') as fdst:
                        print("[Douyin] 开始读取源文件...")
                        while True:
                            chunk = fsrc.read(1024*1024) # 1MB chunks
                            if not chunk:
                                break
                            fdst.write(chunk)
                            
                video_path = temp_video_path # Switch to using the temp copy
                print("[Douyin] 视频手动复制成功，将使用副本进行上传")
            except Exception as copy_err:
                print(f"[Douyin] 视频复制失败: {copy_err}")

            async with async_playwright() as p:
                browser = None
                context = None
                
                if cdp_url:
                    print(f"[Douyin] 正在连接现有 Chrome (CDP): {cdp_url}")
                    try:
                        print(f"[Douyin] 开始建立 CDP 连接...")
                        browser = await p.chromium.connect_over_cdp(endpoint_url=cdp_url, timeout=30000)
                        context = browser.contexts[0]
                        print("[Douyin] CDP 连接成功")
                    except Exception as e:
                        print(f"[Douyin] CDP 连接失败: {e}")
                        return PublishResult(success=False, platform="douyin", error=f"CDP连接失败: {e}")
                else: 
                     print(f"[Douyin] 正在启动浏览器: {browser_path}")
                     browser = await p.chromium.launch(
                        executable_path=browser_path if browser_path and os.path.exists(browser_path) else None,
                        headless=True,
                        args=[
                            '--no-sandbox', 
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-gpu',
                            '--no-first-run',
                            '--no-service-autorun',
                            '--password-store=basic',
                            '--use-mock-keychain',
                            '--disable-features=ProcessSingleton',
                            '--disable-breakpad',
                            '--no-crash-upload',
                            '--disable-blink-features=AutomationControlled'
                        ]
                     )
                     
                     import random
                     viewports = [{'width': 1920, 'height': 1080}, {'width': 1440, 'height': 900}, {'width': 1366, 'height': 768}]
                     vp = random.choice(viewports)
                     print(f"[Douyin] 使用随机视窗: {vp}")
                     
                     context = await browser.new_context(
                        user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        viewport=vp,
                        device_scale_factor=2
                     )
                
                cookies = []
                for key, value in self.credentials.items():
                    cookies.append({
                        "name": key,
                        "value": value,
                        "domain": ".douyin.com",
                        "path": "/"
                    })
                await context.add_cookies(cookies)

                # Load manual cookies if exist
                cookie_path = os.path.join(self.get_project_root(), "douyin_cookies.json")
                if os.path.exists(cookie_path):
                    try:
                        with open(cookie_path, "r") as f:
                            saved_cookies = json.load(f)
                            await context.add_cookies(saved_cookies)
                        print(f"[Douyin] 已加载本地Cookies: {cookie_path}")
                    except Exception as e:
                        print(f"[Douyin] 加载Cookies失败: {e}")

                # Load cookies from credentials if provided as a list
                if self.credentials and 'cookies' in self.credentials and isinstance(self.credentials['cookies'], list):
                    try:
                        await context.add_cookies(self.credentials['cookies'])
                        print(f"[Douyin] 已加载 credentials 中的 cookies")
                    except Exception as e:
                        print(f"[Douyin] 加载 credentials cookies 失败: {e}")
                
                page = await context.new_page()
                
                # 1. 打开创作中心发布页
                print("[Douyin] 正在打开发布页面...")
                
                # Check cookie before navigation
                session_id = self.credentials.get('sessionid', '')
                if session_id:
                    masked = session_id[:6] + '*' * 6 + session_id[-6:]
                    print(f"[Douyin] 使用 SessionID: {masked}")
                else:
                    print("[Douyin] 警告: 未找到 SessionID Cookie")

                target_url = "https://creator.douyin.com/creator-micro/content/upload"
                await page.goto(target_url)
                try:
                    await page.wait_for_load_state('domcontentloaded', timeout=15000)
                except:
                    print("[Douyin] domcontentloaded 超时，继续尝试后续操作")
                await asyncio.sleep(3) # 给页面一定的渲染时间
                
                print(f"[Douyin] 当前页面 URL: {page.url}")
                
                 # --- 会话状态检查 ---
                print("[Douyin] 正在校验登录状态...")
                is_expired = False
                
                # 1. URL检查
                if "login" in page.url or "passport" in page.url or await page.locator('text="扫码登录"').is_visible() or await page.locator('text="验证码登录"').is_visible():
                     print("[Douyin] [Login Check] 状态: ❌ 检测到登录页，尝试自动登录...")
                     
                     # 检查是否因为 Captcha 失败 或 需要扫码
                     print(f"[Douyin] [Login Check] 状态: ❌ 检测到登录页，尝试自动登录...")
                     
                     # 1. OPTIONAL: Password Login (If credentials exist)
                     password_login_success = False
                     if self.credentials and ('username' in self.credentials or 'phone' in self.credentials) and 'password' in self.credentials:
                         try:
                             print("[Douyin] 检测到账号密码，尝试密码登录...")
                             # Find "Password Login" or "Account Login" tab
                             pw_tab = page.locator('div:has-text("密码登录"), div:has-text("账号登录"), span:has-text("密码登录")').last
                             if await pw_tab.count() > 0:
                                 await pw_tab.click()
                                 await asyncio.sleep(1)
                                 
                                 phone = self.credentials.get('username') or self.credentials.get('phone')
                                 pwd = self.credentials.get('password')
                                 
                                 # Fill Inputs
                                 # Selectors might vary; vague matching
                                 phone_input = page.locator('input[placeholder*="手机"], input[placeholder*="账号"], input[name="mobile"]').first
                                 pwd_input = page.locator('input[placeholder*="密码"], input[type="password"]').first
                                 
                                 if await phone_input.count() > 0 and await pwd_input.count() > 0:
                                     await phone_input.fill(phone)
                                     await pwd_input.fill(pwd)
                                     
                                     # Agree to Terms (Checkbox)
                                     checkbox = page.locator('.agreement-checkbox, input[type="checkbox"]').first
                                     if await checkbox.count() > 0:
                                         await checkbox.click(force=True)
                                     
                                     # Click Login
                                     login_btn = page.locator('button:has-text("登录"), div.login-button').first
                                     if await login_btn.count() > 0:
                                         await login_btn.click()
                                         print("[Douyin] 已点击登录按钮，等待滑块验证或跳转...")
                                         
                                         # Wait for potential captcha or success
                                         # If captcha appears, user might need to slide manually in headless? NO, headless supports no manual.
                                         # But user requested "Account Password". If captcha appears, it might fail in headless.
                                         # We wait a bit to see if URL changes.
                                         await asyncio.sleep(5)
                                         if "creator-micro/content/upload" in page.url or await page.locator('.avatar-component').count() > 0:
                                              print("[Douyin] 密码登录成功！")
                                              password_login_success = True
                                              # Break the outer check loop? No, this is inside check loop. Handled by next checks.
                             else:
                                 print("[Douyin] 未找到密码登录切换按钮")
                         except Exception as e:
                             print(f"[Douyin] 密码登录尝试失败: {e}")

                     if not password_login_success:
                         # 2. QR Code Logic (Fallback)
                         # Detect QR Code logic...
                         qr_code = page.locator('div.qrcode-image, img[src*="data:image"], canvas').first # Simple selector
                         if await qr_code.count() > 0:
                             print("[Douyin] 检测到扫码登录区域...")
                             
                             # Wait for QR to render
                             await asyncio.sleep(2)
                             
                             qr_path = os.path.join(self.get_project_root(), "douyin_login_qr.png")
                             
                             # Capture Login Container (Best of both worlds: Focused & Complete)
                             try:
                                 # Try to find the login box container
                                 login_box = page.locator('div[class*="login-container"], div[class*="login-main"], div[class*="account-login"]').first
                                 if await login_box.count() > 0:
                                      await login_box.screenshot(path=qr_path)
                                      print(f"[Douyin] 🚨 请扫描二维码登录! (已截取登录框): {qr_path}")
                                 else:
                                      # Fallback to Full Page if container not found
                                      await page.screenshot(path=qr_path, full_page=True)
                                      print(f"[Douyin] 🚨 请扫描二维码登录! (已截取全屏页面 - Fallback): {qr_path}")
                             except:
                                 await page.screenshot(path=qr_path, full_page=True)
                             print(f"[Douyin] 🚨 请扫描二维码登录! 图片已保存: {qr_path}")
                             
                             # Start - Simple Display (Raw PNG)
                             display_path = qr_path

                             # Open in Preview (Best for Zoom/Pan)
                             try:
                                 import subprocess
                                 subprocess.run(["open", "-a", "Preview", display_path])
                                 print(f"[Douyin] 已尝试在Preview打开二维码: {display_path}")
                             except:
                                 pass

                             print(f"[Douyin] 正在等待扫码结果 (180秒)...")
                             
                             # 轮询检测登录状态 (Check URL or Element)
                             login_success = False
                             for _ in range(90): # 90 * 2s = 180s
                                 # 1. URL Check (Relaxed)
                                 if "creator-micro/content/upload" in page.url:
                                      # Just check if critical login elements are GONE
                                      if await page.locator('text="创作者登录"').count() == 0:
                                          print(f"[Douyin] 检测到URL符合且无登录提示: {page.url}")
                                          login_success = True
                                          break

                                 # 2. Upload Input Check
                                 if await page.locator('input[type="file"]').count() > 0:
                                     print("[Douyin] 检测到上传按钮 (input[type=file])")
                                     login_success = True
                                     break
                                 
                                 # 3. Positive Indicators (Avatar, Nickname, Post Button)
                                 positive_selectors = [
                                     '.avatar-component', 
                                     '.user-avatar', 
                                     '.user-name', 
                                     'button:has-text("发布")',
                                     'div:has-text("作品管理")'
                                 ]
                                 for sel in positive_selectors:
                                     if await page.locator(sel).first.is_visible():
                                         print(f"[Douyin] 检测到登录后元素: {sel}")
                                         login_success = True
                                         break
                                 if login_success: break
                                 
                                 # (Cookie Check Removed - Causes False Positives)
                                 
                                 # Check QR Refresh
                                 refresh_text = page.locator('text="点击刷新", text="验证码已失效", text="刷新二维码"')
                                 if await refresh_text.count() > 0 and await refresh_text.is_visible():
                                     print("[Douyin] 检测到二维码失效，尝试刷新...")
                                     await refresh_text.click()
                                     await asyncio.sleep(2)
                                     # Re-capture Full Page
                                     await page.screenshot(path=qr_path, full_page=True)
                                     
                                     import subprocess
                                     subprocess.run(["open", "-a", "Preview", display_path])
                                     print(f"[Douyin] 二维码已刷新并重新打开 (Preview): {display_path}")

                                 await asyncio.sleep(2)
                             
                             if login_success:
                                 print('[Douyin] 扫码登录成功！')
                                 is_expired = False
                                 clicked = True
                                 try:
                                     session_cookies = await context.cookies()
                                     cookie_path = os.path.join(self.get_project_root(), 'douyin_cookies.json')
                                     with open(cookie_path, 'w') as cf:
                                         json.dump(session_cookies, cf)
                                     print(f'[Douyin] 登录状态已保存: {cookie_path}')
                                 except Exception as ce: print(f'[Douyin] 保存Cookies失败: {ce}')
                                 
                                 print('[Douyin] 正在尝试进入发布页面...')
                                 await page.goto('https://creator.douyin.com/creator-micro/content/upload')
                                 await asyncio.sleep(3)
                             else:
                                 print('[Douyin] 扫码登录超时')
                else:
                    print("[Douyin] [Login Check] 状态: ✅ 有效 (未检测到登录阻断)")
                if is_expired:
                    print("[Douyin] 检测到会话已过期，且自动登录失败或不支持")
                    root_dir = self.get_project_root()
                    await page.screenshot(path=os.path.join(root_dir, 'douyin_login_redirect.png'))
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="登录失效，请重新登录")

                # 0. 检查并关闭“继续编辑”草稿提示
                print("[Douyin] 检查是否有未完成的草稿提示...")
                async def clear_drafts():
                    try:
                        # 分开查找以确保成功率
                        for label in ["放弃", "上次未发布", "继续编辑"]:
                            btns = page.locator(f'text="{label}"')
                            count = await btns.count()
                            for i in range(count):
                                btn = btns.nth(i)
                                if await btn.is_visible():
                                    print(f"[Douyin] 发现疑似草稿控件 ({label})，点击强制执行放弃...")
                                    await btn.click(timeout=3000)
                                    await asyncio.sleep(1)
                        # JS 增强清理
                        await page.evaluate("""() => {
                            document.querySelectorAll('button, span, div').forEach(el => {
                                if (el.innerText.includes('放弃') && el.innerText.length < 5) {
                                    el.click();
                                }
                            });
                        }""")
                    except: pass

                await clear_drafts()

                # 1. 等待上传入口
                print("[Douyin] 等待上传入口...")
                
                # 尝试点击常见弹窗关闭按钮 (fresh login 往往有弹窗)
                try:
                    close_btns = page.locator('.semi-modal-close, [class*="close-btn"], button:has-text("我知道了"), button:has-text("以后再说"), [aria-label="关闭"]')
                    if await close_btns.count() > 0:
                        if await close_btns.first.is_visible():
                            await close_btns.first.click()
                            print("[Douyin] 已尝试关闭阻挡弹窗")
                            await asyncio.sleep(1)
                except: pass

                selector = 'input[type="file"], div:has-text("点击上传"), div:has-text("上传视频"), [class*="container-drag"]'
                
                for attempt_entry in range(3):
                    try:
                        upload_input = await page.wait_for_selector(
                            selector, 
                            state='attached', 
                            timeout=10000
                        )
                        if upload_input: break
                    except:
                        print(f"[Douyin] 尝试寻找上传入口 (第 {attempt_entry+1} 次)...")
                        await clear_drafts()
                        if attempt_entry == 1: await page.reload()
                else: # Loop finished without break
                    # Screenshot and fail
                    root_dir = self.get_project_root()
                    print("[Douyin] 错误: 未找到上传入口")
                    try:
                         body_text = await page.inner_text('body', timeout=2000)
                         body_text_clean = body_text[:1000].replace('\n', ' ')
                         print(f"[Douyin] 页面文本快照 (Start): {body_text_clean}")
                    except:
                         print("[Douyin] 无法获取页面文本")

                    await page.screenshot(path=os.path.join(root_dir, 'douyin_entry_fail.png'))
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="未找到上传入口")

                # 确保是 input[type=file]
                tag_name = await upload_input.evaluate("el => el.tagName")
                if tag_name.lower() != 'input':
                    print(f"[Douyin] 找到上传区域 ({tag_name})，定位隐藏的文件输入框...")
                    upload_input = page.locator('input[type="file"]').first
                    if await upload_input.count() == 0:
                         print("[Douyin] 未找到 input[type=file]")
                         await browser.close()
                         return PublishResult(success=False, platform=self.platform_id, error="未找到文件输入框")

                # 2. 上传视频
                print("[Douyin] 正在上传视频...")
                await upload_input.set_input_files(video_path)
                
                # 3. 等待上传完成并加载编辑表单
                print("[Douyin] 等待上传完成并加载编辑表单...")
                upload_success = False
                root_dir = self.get_project_root()
                for i_wait in range(60): 
                    # 强校验：URL 必须包含 'post/video' 且 标题输入框必须可见
                    if "post/video" in page.url:
                         if await page.locator('input[placeholder*="添加标题"], .notranslate[contenteditable="true"]').count() > 0:
                            print("[Douyin] 检测到编辑表单已真正加载！")
                            await page.screenshot(path=os.path.join(root_dir, 'douyin_editor_loaded.png'))
                            upload_success = True
                            break
                    
                    if i_wait % 10 == 0:
                        print(f"[Douyin] 等待中... 当前URL: {page.url}")
                        await page.screenshot(path=os.path.join(root_dir, f'douyin_upload_wait_{i_wait}.png'))
                    
                    reupload_btn = page.locator('text="重新上传"').first
                    if await reupload_btn.count() > 0 and await reupload_btn.is_visible():
                        if await page.locator('input[placeholder*="标题"], .notranslate[contenteditable="true"]').count() > 0:
                            print("[Douyin] 视频上传完毕并进入编辑页！")
                            upload_success = True
                            break
                        
                    if await page.locator('text="上传失败"').count() > 0:
                         raise Exception("检测到'上传失败'提示")
                         
                    await asyncio.sleep(2)

                if not upload_success:
                    print(f"[Douyin] 等待上传超时或失败 (当前URL: {page.url})")
                    root_dir = self.get_project_root()
                    await page.screenshot(path=os.path.join(root_dir, 'douyin_upload_timeout.png'))
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="视频上传超时，未进入编辑页面")

                # Upload Successful -> Continue to Form Filling
                print("[Douyin] 检测到编辑表单已真正加载！")

                # Save Cookies for future runs
                try:
                    cookies = await context.cookies()
                    cookie_path = os.path.join(self.get_project_root(), "douyin_cookies.json")
                    with open(cookie_path, "w") as f:
                        json.dump(cookies, f)
                    print(f"[Douyin] 登录状态已保存: {cookie_path}")
                except: pass

                # 4. 填写标题 (title 和 desc 已在方法开始时提取)
                print(f"[Douyin] 填写标题: {title}")
                await asyncio.sleep(2)
                
                title_filled = False
                try:
                    # 优先尝试 placeholder 方式 (最通用)
                    title_input = page.locator('input[placeholder*="添加标题"], input[placeholder*="输入标题"], input.semi-input').first
                    if await title_input.count() > 0 and await title_input.is_visible():
                        await title_input.fill(title)
                        title_filled = True

                    if not title_filled:
                        # 尝试 .notranslate
                        editor = page.locator(".notranslate").first
                        if await editor.count() > 0 and await editor.is_visible():
                            await editor.click()
                            await editor.press("Control+A")
                            await editor.press("Backspace")
                            await editor.fill(f"{title}\n{desc}")
                            title_filled = True
                            print("[Douyin] 使用 .notranslate 填写标题成功")

                    if not title_filled:
                        # 尝试 XPATH
                        title_container = page.get_by_text('作品标题').locator("..").locator("xpath=following-sibling::div[1]").locator("input")
                        if await title_container.count() > 0:
                            await title_container.fill(f"{title}\n{desc}")
                            title_filled = True
                            print("[Douyin] 使用 XPATH 填写标题成功")

                except Exception as e:
                    print(f"[Douyin] 填写标题异常: {e}")

                # 5. 设置封面 & 发布流程
                print("[Douyin] 准备发布流程...")

                def extract_video_cover(v_path, c_path):
                    print(f"[Douyin] 正在提取封面: {v_path}")
                    ffmpeg_path = os.path.join(root_dir, ".browsers/ffmpeg-1011/ffmpeg-mac")
                    if not os.path.exists(ffmpeg_path):
                        ffmpeg_path = "ffmpeg"
                    
                    try:
                        if os.path.exists(c_path): os.remove(c_path)
                        # 提取第1.0秒的帧
                        os.system(f'"{ffmpeg_path}" -y -ss 00:00:01 -i "{v_path}" -frames:v 1 -q:v 2 "{c_path}" > /dev/null 2>&1')
                        if os.path.exists(c_path): return True
                    except: pass
                    
                    # 极端兜底
                    data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\xd7c\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb0\x00\x00\x00\x00IEND\xaeB`\x82'
                    with open(c_path, 'wb') as f: f.write(data)
                    return False

                async def dismiss_popups():
                    for _ in range(3):
                        p = page.locator('button:has-text("我知道了"), button:has-text("暂不设置"), button:has-text("确定")')
                        if await p.count() > 0:
                            for i in range(await p.count()):
                                try:
                                    if await p.nth(i).is_visible():
                                        print(f"[Douyin] 关闭弹窗/提示: {await p.nth(i).inner_text()}")
                                        await p.nth(i).click(timeout=1000)
                                        await asyncio.sleep(0.5)
                                except: pass
                        else: break

                async def violent_clean():
                    # print("[Douyin] 执行暴力清理遮罩和弹窗...")
                    # 暂时禁用，防止误删编辑器本身
                    pass
                
                async def ensure_cover_set():
                    print("[Douyin] 正在尝试设置封面...")
                    try:
                        # 0. 滚动到顶部以看到封面区域
                        await page.evaluate("window.scrollTo(0, 0)")
                        await asyncio.sleep(1)
                        
                        # 1. 寻找封面入口
                        # 抖音有时显示“选择封面”，有时显示“编辑封面”
                        entry = page.locator('div[class*="cover"], [class*="upload-container"], :text("选择封面"), :text("编辑封面")').first
                        if await entry.count() > 0:
                            print("[Douyin] 点击封面区域...")
                            await entry.click()
                            await asyncio.sleep(3)
                            
                            # 弹窗内上传
                            for frame in page.frames:
                                if "creator-micro" in frame.url or "post/video" in frame.url:
                                    f_input = frame.locator('input[type="file"]').first
                                    if await f_input.count() > 0:
                                        print("[Douyin] [Frame] 上传封面图片...")
                                        root_dir = self.get_project_root()
                                        cover_path = os.path.join(root_dir, 'video_cover.jpg')
                                        extract_video_cover(video_path, cover_path)
                                        await f_input.set_input_files(cover_path)
                                        await asyncio.sleep(4)
                                        
                                        # 点击完成按钮
                                        done_btns = frame.locator('button:has-text("完成"), button:has-text("保存"), button:has-text("确认")')
                                        for i in range(await done_btns.count()):
                                            btn = done_btns.nth(i)
                                            if await btn.is_visible():
                                                print(f"[Douyin] [Frame] 点击完成按钮: {await btn.inner_text()}")
                                                await btn.click()
                                                await asyncio.sleep(2)
                                                break
                                        break
                        
                        # 特殊保护：如果还开着弹窗，点一下页面空白处或ESC
                        if await page.locator('.semi-modal-content').count() > 0:
                             await page.keyboard.press("Escape")
                    except Exception as e:
                        print(f"[Douyin] 设置封面过程异常: {e}")

                # Start publish logic
                await ensure_cover_set()
                
                async def click_publish():
                    print(f"[Douyin] 正在尝试发布...")
                    # 滚动到底部
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await asyncio.sleep(1)
                    
                    await dismiss_popups()
                    
                    publish_btn = None
                    # 尝试多种可能的按钮组合
                    for frame in page.frames:
                        try:
                            # 1. 尝试 get_by_role
                            for label in ["发布", "确认发布", "立即发布", "发布作品"]:
                                btns = frame.get_by_role("button", name=label)
                                count = await btns.count()
                                if count > 0:
                                    for i in range(count):
                                        btn = btns.nth(i)
                                        text = await btn.inner_text()
                                        if "高清" not in text and await btn.is_visible():
                                            print(f"[Douyin] 找到发布按钮 (get_by_role): '{text}'")
                                            publish_btn = btn; break
                                    if publish_btn: break
                            if publish_btn: break
                            
                            # 2. 尝试 CSS 选择器 (常见类名)
                            for selector in ["button.primary", "button[class*='primary']", "button[class*='publish']"]:
                                btns = frame.locator(selector)
                                count = await btns.count()
                                if count > 0:
                                    for i in range(count):
                                        btn = btns.nth(i)
                                        text = await btn.inner_text()
                                        if "发布" in text and "高清" not in text and await btn.is_visible():
                                            print(f"[Douyin] 找到发布按钮 (selector {selector}): '{text}'")
                                            publish_btn = btn; break
                                    if publish_btn: break
                            if publish_btn: break
                        except: continue

                    if publish_btn:
                        if await publish_btn.is_enabled():
                            try:
                                print("[Douyin] 点击发布按钮...")
                                await publish_btn.click(force=True, timeout=10000)
                                return True
                            except Exception as e:
                                print(f"[Douyin] 物理点击失败: {e}，尝试 JS 模拟点击")
                                await page.evaluate('btn => btn.click()', await publish_btn.element_handle())
                                return True
                        else:
                            print("[Douyin] 发布按钮目前不可用(可能正在解析视频)")
                    return False

                max_retries = 10 
                success_detected = False
                for attempt in range(max_retries):
                    try:
                        print(f"[Douyin] 发布循环 (尝试 {attempt+1}/{max_retries})...")
                        page_content = await page.content()
                        if "处理中" in page_content or "解析中" in page_content:
                            print("[Douyin] 视频仍在处理中，等待 5 秒...")
                            await asyncio.sleep(5)
                        
                        if await click_publish():
                            print("[Douyin] 已触发发布点击，检测反馈...")
                            await asyncio.sleep(4)
                            await page.screenshot(path=os.path.join(root_dir, f"douyin_after_click_{attempt}.png"))
                            
                            current_content = await page.content()
                            # 严格报错检查
                            if await page.locator('.semi-toast-overlay:has-text("失败"), .semi-toast-overlay:has-text("开小差")').count() > 0 or "开小差" in current_content:
                                print("[Douyin] 检测到服务器错误或网络波动，进行重试...")
                                continue 
                            
                            # 拦截验证码/安全提示
                            if "验证码" in current_content or "安全验证" in current_content or "短信验证" in current_content:
                                print("[Douyin] SMS_CHALLENGE_DETECTED")
                                print("[Douyin] 请在聊天框告知我收到的验证码，或者在终端输入。")
                                try:
                                    # 自动点击“获取验证码”
                                    # 尝试更宽泛的定位，因为文本可能是在 span 或 div 里
                                    # 且不强求 .send-code-btn 类名
                                    get_code_candidates = page.locator('text="获取验证码"')
                                    count = await get_code_candidates.count()
                                    print(f"[Douyin] 找到 {count} 个‘获取验证码’元素")
                                    
                                    clicked_code = False
                                    for i in range(count):
                                        el = get_code_candidates.nth(i)
                                        if await el.is_visible():
                                            txt_before = await el.inner_text()
                                            print(f"[Douyin] 点击第 {i+1} 个‘获取验证码’元素 (Before: {txt_before})")
                                            try:
                                                await el.click(timeout=3000, force=True)
                                                await asyncio.sleep(1)
                                                txt_after = await el.inner_text()
                                                print(f"[Douyin] 点击后文本 (After): {txt_after}")
                                            except Exception as e:
                                                print(f"[Douyin] 点击异常: {e}")
                                            
                                            clicked_code = True
                                            break
                                    
                                    if not clicked_code:
                                        print("[Douyin] 警告: 未能点击‘获取验证码’按钮 (未找到可见元素)")
                                    
                                    # 寻找输入框并聚焦
                                    code_input = page.locator('input[placeholder*="验证码"]').first
                                    if await code_input.count() > 0:
                                        await code_input.click()
                                        # 在自动化环境下，我们通过 input() 等待外部输入 (由 Agent 中转)
                                        # 注意: tool 环境下 input() 可能会挂起，但 Agent 可以通过 send_command_input 写入
                                        import sys
                                        print("[Douyin] WAITING_FOR_CODE_INPUT...", flush=True)
                                        code = sys.stdin.readline().strip()
                                        if code:
                                            print(f"[Douyin] 收到输入码，正在尝试验证: {code}")
                                            await code_input.fill(code)
                                            await asyncio.sleep(0.5)
                                            
                                            # 策略1: 尝试回车
                                            await code_input.press("Enter")
                                            await asyncio.sleep(1)
                                            
                                            # 策略2: 点击可见的验证按钮
                                            # 可能是 button 或 div type=button
                                            potential_btns = page.locator('button, div[role="button"]').filter(has_text=re.compile(r"验证|确定|Verify|Confirm"))
                                            count = await potential_btns.count()
                                            clicked = False
                                            for i in range(count):
                                                btn = potential_btns.nth(i)
                                                if await btn.is_visible():
                                                    txt = await btn.inner_text()
                                                    # 排除无关按钮
                                                    if "获取" in txt or "重新" in txt: continue
                                                    
                                                    print(f"[Douyin] 点击可见验证按钮: {txt}")
                                                    await btn.click(timeout=3000)
                                                    clicked = True
                                                    break
                                            
                                            # 验证后重新获取内容判断
                                            await asyncio.sleep(5)
                                            current_content = await page.content()
                                            if "验证码" not in current_content:
                                                print("[Douyin] 验证通过，由于流程中断，准备重新点击发布...")
                                                continue # 关键修改：验证后强制进入下一次循环去点击发布
                                            else:
                                                print("[Douyin] 验证可能失败，继续尝试...")
                                except Exception as e:
                                    print(f"[Douyin] 交互验证过程出错: {e}")
                                    
                            # ---------------------------------------------------------
                            #  成功状态检测 (严格模式)
                            # ---------------------------------------------------------
                            
                            # 1. 优先等待跳转管理页 (最稳妥)
                            try:
                                print("[Douyin] 等待跳转管理页面 (确认发布成功)...")
                                await page.wait_for_url(lambda u: "/content/manage" in u and "/login/" not in u, timeout=10000)
                                print("[Douyin] 已跳转到管理页，发布确认成功！")
                                success_detected = True; break
                            except:
                                # 2. 如果没跳转，检查是否有明确的“作品已发布” Toast (排除验证成功)
                                if await page.locator('.semi-toast-overlay:has-text("作品已发布"), .semi-toast-content:has-text("发布成功")').count() > 0:
                                     print("[Douyin] 检测到'作品已发布'提示！")
                                     success_detected = True; break
                                
                                print("[Douyin] 未检测到成功跳转或提示，可能是网络波动或仍在处理，继续重试...")
                                
                        else:
                            await asyncio.sleep(3)
                            if attempt % 2 == 1: await ensure_cover_set()
                    except Exception as e:
                        print(f"[Douyin] 发布循环尝试异常: {e}")
                        await asyncio.sleep(2)

                if success_detected:
                     await browser.close()
                     return PublishResult(success=True, platform=self.platform_id, post_id="douyin_web_publish", url="https://creator.douyin.com/creator/content/manage")
                else:       
                    root_dir = self.get_project_root()
                    await page.screenshot(path=os.path.join(root_dir, 'douyin_final_error.png'))
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="发布超时或未成功跳转")

        except Exception as e:
            import traceback
            traceback.print_exc()
            return PublishResult(success=False, platform=self.platform_id, error=f"Playwright发布异常: {str(e)}")

    async def _upload_video(self, video_path: str) -> Optional[Dict[str, Any]]:
        """Deprecated: 使用 Playwright 直接上传"""
        return None

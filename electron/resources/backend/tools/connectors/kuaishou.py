"""
Kuaishou Connector
快手平台连接器
"""

import os
import time
import asyncio
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class KuaishouConnector(BaseConnector):
    """
    快手连接器
    """
    
    @property
    def platform_name(self) -> str:
        return "快手"
    
    @property
    def required_credentials(self) -> List[str]:
        # Kuaishou PC Web uses these for authentication
        return ['kuaishou.web.api_st', 'passToken']
    
    async def verify_connection(self) -> bool:
        # Check if we have at least one of the major auth tokens
        # We check for a variety of possible auth cookies across different Kuaishou versions/regions
        ks_auth_keys = [
            'kuaishou.web.api_st', 
            'kuaishou.web.api_ph',
            'kuaishou.server.web_st', 
            'passToken', 
            'client_key',
            'kwssectoken'
        ]
        has_auth = any(k in self.credentials for k in ks_auth_keys)
        
        # If we have at least 3-4 cookies, it's usually a successful login session
        return has_auth or len(self.credentials) > 10

    async def get_account_info(self) -> Dict[str, Any]:
        return {"username": self.credentials.get("username", "快手用户"), "uid": ""}

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
        发布内容到快手
        """
        from playwright.async_api import async_playwright
        
        # Extract parameters
        if isinstance(content, dict):
            legacy_content = content
            content_type = legacy_content.get("type", content_type)
            media_urls = [legacy_content.get("video_path")] if legacy_content.get("video_path") else media_urls
            text_content = legacy_content.get("description", "")
        else:
            text_content = str(content)

        if not media_urls:
            return PublishResult(success=False, platform=self.platform_id, error="未提供媒体文件")

        media_path = media_urls[0]
        root_dir = self.get_project_root()
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
        
        # Determine strict local temp dir to avoid system EPERM
        local_tmp = os.path.join(root_dir, "tmp")
        os.makedirs(local_tmp, exist_ok=True)
        os.environ["TMPDIR"] = local_tmp
        
        possible_paths = [
            os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
            os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        ]
        
        browser_path = next((p for p in possible_paths if os.path.exists(p)), None)
        
        # Resolve media path
        filename = os.path.basename(media_path)
        if "?" in filename:
            filename = filename.split("?")[0]
            
        original_root = os.environ.get("ORIGINAL_PROJECT_DIR", root_dir)
        search_paths = [
            media_path,
            os.path.join(original_root, "storage/outputs", filename),
            os.path.join(original_root, "storage/uploads", filename),
            os.path.join(original_root, filename),
            os.path.join(root_dir, "storage/uploads", filename),
            os.path.join(root_dir, "storage/outputs", filename),
        ]
        
        print(f"[Kuaishou] Debug Path Discovery:")
        print(f"  - root_dir: {root_dir}")
        print(f"  - original_root: {original_root}")
        print(f"  - media_path (input): {media_path}")
        
        final_media_path = None
        for p in search_paths:
            exists = os.path.exists(p)
            print(f"  - Testing {p}: {'EXISTS' if exists else 'MISSING'}")
            if exists and os.path.isfile(p):
                final_media_path = p
                print(f"[Kuaishou] 找到文件: {p}")
                break
        
        if not final_media_path:
             # Try one last check in current working directory
             cwd_p = os.path.join(os.getcwd(), filename)
             if os.path.exists(cwd_p):
                 final_media_path = cwd_p
                 print(f"[Kuaishou] 找到文件 (CWD): {cwd_p}")
             else:
                 return PublishResult(success=False, platform=self.platform_id, error=f"文件不存在: {media_path}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path=browser_path,
                headless=True,
                args=[
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--window-size=1280,720',
                ]
            )
            
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            
            # Add stealth script
            stealth_path = os.path.join(os.path.dirname(__file__), "stealth.min.js")
            if os.path.exists(stealth_path):
                await context.add_init_script(path=stealth_path)
            
            # Load cookies
            cookies = []
            for name, value in self.credentials.items():
                cookies.append({
                    "name": name,
                    "value": str(value),
                    "domain": ".kuaishou.com",
                    "path": "/"
                })
            
            # Check for saved cookies file
            cookie_file = os.path.join(root_dir, "kuaishou_cookies.json")
            if os.path.exists(cookie_file):
                try:
                    with open(cookie_file, "r") as f:
                        saved_cookies = json.load(f)
                        await context.add_cookies(saved_cookies)
                except Exception as e:
                    print(f"[Kuaishou] Load saved cookies failed: {e}")
            
            if cookies:
                await context.add_cookies(cookies)

            page = await context.new_page()
            
            print("[Kuaishou] 正在打开发布页...")
            try:
                await page.goto("https://cp.kuaishou.com/article/publish/video", timeout=60000)
            except Exception as e:
                print(f"[Kuaishou] Navigation failed: {e}")
                
            # Handle potential popups immediately (Tutorials, Joyride, etc)
            print("[Kuaishou] Setting up continuous overlay clearing...")
            try:

                # Click "Skip" or "Next" in Joyride if it still exists
                try:
                    await page.click('[aria-label="Skip"]', timeout=3000)
                except:
                    pass
                try:
                    await page.click('div:has-text("我知道了")', timeout=2000)
                except:
                    pass

                # Click common "Got it" buttons once just in case
                for text in ["我知道了", "下次再说", "取消", "确定"]:
                    btn = page.locator(f'button:has-text("{text}")').first
                    if await btn.is_visible():
                        await btn.click()
            except Exception as e:
                print(f"[Kuaishou] Warning during initial overlay clearing: {e}")
            except Exception as e:
                print(f"[Kuaishou] Warning during initial overlay clearing: {e}")

            # Check login by looking for specific elements
            try:
                # Expecting an upload button or specific text
                await page.wait_for_selector('div.ant-upload, button:has-text("上传视频")', timeout=20000)
            except Exception as e:
                # Page might have closed or timed out
                if page.is_closed():
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="页面已意外关闭")
                
                if "login" in page.url or await page.locator('text="登录"').count() > 0:
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="未登录或会话已过期")
                
                print(f"[Kuaishou] Wait for upload selector failed, but might be okay: {e}")

            # Upload
            print(f"[Kuaishou] Uploading {final_media_path}...")
            try:
                # Kuaishou typically uses standard input[type=file] but sometimes hidden
                # Finding the file input is safer than clicking
                file_input = page.locator('input[type="file"]').first
                if await file_input.count() > 0:
                     await file_input.set_input_files(final_media_path)
                else:
                    # Fallback to file chooser
                    upload_trigger = page.locator('div.ant-upload, button:has-text("上传视频")').first
                    async with page.expect_file_chooser() as fc_info:
                        await upload_trigger.click()
                    file_chooser = await fc_info.value
                    await file_chooser.set_files(final_media_path)
            except Exception as e:
                await browser.close()
                return PublishResult(success=False, platform=self.platform_id, error=f"Upload failed: {e}")

            # 1. Wait for upload completion
            print("[Kuaishou] Waiting for upload to complete...")
            try:
                # Wait for upload success indicator (e.g., progress 100% or "重新上传" appearing)
                # Kuaishou shows "上传成功" and usually the video preview or "重新上传" button
                upload_finished = False
                for _ in range(30): # 60 seconds max
                    if page.is_closed(): break
                    
                    content_html = await page.content()
                    if "上传成功" in content_html or "重新上传" in content_html:
                        upload_finished = True
                        print("[Kuaishou] Upload finished detected.")
                        break
                    
                    # Check for error messages
                    if "上传失败" in content_html or "格式不支持" in content_html:
                        print("[Kuaishou] Upload failed text detected in page.")
                        break
                        
                    await asyncio.sleep(2)
                
                if not upload_finished:
                    print("[Kuaishou] Warning: Upload success indicator not found after timeout.")
                    await page.screenshot(path="/tmp/ks_upload_timeout.png")
            except Exception as e:
                print(f"[Kuaishou] Error while waiting for upload: {e}")
            
            await asyncio.sleep(5)

            # 2. Fill content
            print(f"[Kuaishou] Filling description: {text_content[:20]}...")
            try:
                # Debug: check what we have
                try:
                    await page.screenshot(path="/tmp/ks_before_desc.png")
                except Exception as e:
                    print(f"[Kuaishou] Screenshot failed: {e}")
                
                # Try multiple selectors for the editor
                editor_selectors = [
                    'div[contenteditable="true"]',
                    '.editor-container div[contenteditable="true"]',
                    'div[placeholder*="标题"]',
                    'div[placeholder*="描述"]'
                ]
                
                editor = None
                for selector in editor_selectors:
                    loc = page.locator(selector).first
                    if await loc.count() > 0:
                        editor = loc
                        print(f"[Kuaishou] Found editor with selector: {selector}")
                        break
                
                if editor:
                    # Use evaluate to focus and bypass any overlays
                    await editor.evaluate('node => node.focus()')
                    await editor.fill(text_content)
                else:
                    # Fallback to textarea
                    print("[Kuaishou] Editor not found, trying textarea fallback...")
                    await page.fill('textarea', text_content)
            except Exception as e:
                print(f"[Kuaishou] Failed to fill description: {e}")
                # Try one last desperate attempt with JS
                try:
                    await page.evaluate(f'document.querySelector("div[contenteditable=\\"true\\"]").innerText = "{text_content}"')
                except:
                    pass

            await asyncio.sleep(2)

            # 4. Click Publish
            print("[Kuaishou] Looking for publish button or 'Next' steps...")
            try:
                import re
                publish_regex = re.compile(r'^发布$')
                # Keywords for dismissing guides/popups
                dismiss_regex = re.compile(r'下一步|立刻体验|我知道了|已检查完毕|跳过|关闭|确认|确定')
                
                pub_btn = None
                for attempt in range(10): # Increase attempts
                    if page.is_closed(): break
                    
                    # 1. Look for Guides/Popups/Modals across all frames first
                    clicked_dismiss = False
                    for frame in page.frames:
                        try:
                            # Search for common dismiss elements - prioritize real buttons
                            candidates = frame.locator('button, [role="button"], .ant-btn, div, span, i')
                            count = await candidates.count()
                            for i in range(count):
                                b = candidates.nth(i)
                                if await b.is_visible():
                                    txt = (await b.inner_text()).strip()
                                    if dismiss_regex.search(txt) and not publish_regex.search(txt):
                                        print(f"[Kuaishou] Dismissing guide/popup: '{txt}' in frame {frame.name or 'main'}")
                                        try:
                                            await b.click(force=True, timeout=3000)
                                        except:
                                            await b.evaluate('el => el.click()')
                                        clicked_dismiss = True
                                        break
                                    # Also check for 'x' or close icons if possible
                                    cls = await b.get_attribute("class") or ""
                                    if "close" in cls.lower() or "skip" in cls.lower():
                                        print(f"[Kuaishou] Clicking potential close icon (Class: {cls})")
                                        await b.click(force=True, timeout=3000)
                                        clicked_dismiss = True
                                        break
                            if clicked_dismiss: break
                        except: continue
                    
                    if clicked_dismiss:
                        print(f"[Kuaishou] Action taken to clear view (Attempt {attempt})")
                        await asyncio.sleep(2)
                        # If stuck after 3 dismiss actions, try force-deleting the guide DOM
                        if attempt >= 3:
                            print(f"[Kuaishou] Still stuck on guide at attempt {attempt}, force-clearing DOM overlays...")
                            await page.evaluate('''() => {
                                const sels = ['.react-joyride__overlay', '.__floater', '#react-joyride-portal', '.ant-modal-mask', '.ant-modal-wrap'];
                                sels.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
                            }''')
                        continue
                        
                    # 2. Look for Publish button only if nothing obvious is blocking
                    for frame in page.frames:
                        try:
                            candidates = frame.locator('button, [role="button"], .ant-btn, div, span')
                            count = await candidates.count()
                            for i in range(count):
                                b = candidates.nth(i)
                                if await b.is_visible():
                                    txt = (await b.inner_text()).strip()
                                    if txt == "发布":
                                        pub_btn = b
                                        break
                            if pub_btn: break
                        except: continue
                    
                    if pub_btn:
                        print(f"[Kuaishou] Found publish button at attempt {attempt}")
                        break
                    
                    # 3. Scroll if nothing found
                    print(f"[Kuaishou] No obvious action found at attempt {attempt}, scrolling...")
                    await page.keyboard.press("PageDown")
                    await page.evaluate('''() => {
                        window.scrollTo(0, window.scrollY + 500);
                        document.querySelectorAll('div, section, main').forEach(c => {
                            if (c.scrollHeight > c.clientHeight) c.scrollTop += 500;
                        });
                    }''')
                    await asyncio.sleep(2)
                
                if pub_btn:
                    print(f"[Kuaishou] Clicking final publish button...")
                    await pub_btn.scroll_into_view_if_needed()
                    try:
                        await pub_btn.click(force=True, timeout=5000)
                    except:
                        await pub_btn.evaluate('el => el.click()')
                else:
                    # Final fallback
                    try:
                        await page.click('button:has-text("发布"), .ant-btn:has-text("发布")', timeout=3000)
                        print("[Kuaishou] Used fallback publish click")
                    except:
                        # Capture debug info
                        try:
                            await page.screenshot(path="/tmp/ks_no_btn_after_steps.png")
                        except: pass
                        raise Exception("Could not find any 'Publish' button after clearing guides")
                    
                    # Handle "Compliance" modal if it appears
                    try:
                        await asyncio.sleep(2)
                        confirm_btn = page.locator('button:has-text("确定")').first
                        if await confirm_btn.is_visible():
                            await confirm_btn.click()
                    except:
                        pass

                # 5. Verify Success
                print("[Kuaishou] Verifying success...")
                # Wait for navigation or success message
                try:
                    await page.wait_for_function('() => window.location.href.includes("manage") || document.body.innerText.includes("发布成功")', timeout=20000)
                    print("[Kuaishou] Publish Success Verified")
                    if not browser.is_connected(): return PublishResult(success=True, platform=self.platform_id, post_id="ks_web_post")
                    await browser.close()
                    return PublishResult(success=True, platform=self.platform_id, post_id="ks_web_post")
                except:
                    pass
                
                # Final check
                if "manage" in page.url:
                    if browser.is_connected(): await browser.close()
                    return PublishResult(success=True, platform=self.platform_id)
                
                # Capture failure
                error_path = "/tmp/ks_publish_fail.png"
                try:
                    if not page.is_closed():
                        await page.screenshot(path=error_path)
                        html = await page.content()
                        with open("/tmp/ks_publish_fail.html", "w") as f:
                            f.write(html)
                        print(f"[Kuaishou] Publish verification failed. Screenshot saved to {error_path}")
                except Exception as e:
                    print(f"[Kuaishou] Screenshot/HTML dump failed: {e}")
                
                if browser.is_connected(): await browser.close()
                return PublishResult(success=False, platform=self.platform_id, error="发布后未检测到成功状态")

            except Exception as e:
                # Capture error screenshot
                error_path = "/tmp/ks_publish_error.png"
                try:
                    if not page.is_closed():
                        await page.screenshot(path=error_path)
                except Exception as screenshot_e:
                    print(f"[Kuaishou] Screenshot failed: {screenshot_e}")
                
                if browser.is_connected(): await browser.close()
                return PublishResult(success=False, platform=self.platform_id, error=f"Publish button interaction failed: {e}")

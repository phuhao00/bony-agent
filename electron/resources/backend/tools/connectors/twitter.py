"""
Twitter (X) Connector
Twitter (X) 平台连接器
"""

import os
import time
import asyncio
import json
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class TwitterConnector(BaseConnector):
    """
    Twitter (X) 连接器
    """
    
    @property
    def platform_name(self) -> str:
        return "Twitter"
    
    @property
    def required_credentials(self) -> List[str]:
        # Twitter usually uses auth_token cookie
        return ["auth_token"]
    
    async def verify_connection(self) -> bool:
        # Check if auth_token is present
        return "auth_token" in self.credentials

    async def get_account_info(self) -> Dict[str, Any]:
        return {"username": self.credentials.get("username", "Twitter User"), "uid": ""}

    async def publish_content(
        self, 
        content_type: str = "text", 
        title: str = "", 
        content: Any = "", 
        media_urls: List[str] = None, 
        options: Dict[str, Any] = None,
        **kwargs
    ) -> PublishResult:
        """
        发布内容到 Twitter (X)
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

        root_dir = self.get_project_root()
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
        
        # Determine local storage dir for temporary artifacts
        local_tmp = os.path.join(root_dir, "storage", "temp")
        os.makedirs(local_tmp, exist_ok=True)
        
        possible_paths = [
            os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
            os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        ]
        
        browser_path = next((p for p in possible_paths if os.path.exists(p)), None)
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(
                executable_path=browser_path,
                headless=True,
                args=['--no-sandbox', '--disable-blink-features=AutomationControlled']
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
                if name in ["auth_token", "ct0"]: # Common twitter cookies
                    cookies.append({
                        "name": name,
                        "value": value,
                        "domain": ".x.com",
                        "path": "/"
                    })
            
            # Check for twitter_cookies.json
            cookie_file = os.path.join(root_dir, "twitter_cookies.json")
            if os.path.exists(cookie_file):
                with open(cookie_file, "r") as f:
                    saved_cookies = json.load(f)
                    await context.add_cookies(saved_cookies)
            
            if cookies:
                await context.add_cookies(cookies)

            page = await context.new_page()
            
            print("[Twitter] 正在打开 Twitter 发布建议页...")
            await page.goto("https://x.com/compose/post", timeout=60000)
            
            # Check login
            try:
                await page.wait_for_selector('div[data-testid="tweetTextarea_0"]', timeout=15000)
            except:
                if await page.locator('text="Log in"').count() > 0:
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="未登录或会话已过期")
            
            # 1. Handle potential popups/masks
            try:
                # Check for common modal close buttons or dismiss actions
                popups = [
                    'div[aria-label="Close"]', 
                    'div[data-testid="app-bar-close"]',
                    'span:text("Maybe later")',
                    'span:text("Not now")',
                    'span:text("Dismiss")'
                ]
                for p in popups:
                    if await page.locator(p).count() > 0:
                        print(f"[Twitter] Found popup {p}, closing...")
                        await page.locator(p).first.click()
                        await asyncio.sleep(1)
            except Exception as e:
                print(f"[Twitter] Popup handling warning: {e}")

            # 1. Fill Text Content
            print(f"[Twitter] 填写推文内容: {text_content[:30]}...")
            # Use .first to avoid strict mode violation (background composer vs modal composer)
            editor = page.locator('div[data-testid="tweetTextarea_0"]').first
            try:
                await editor.click(force=True)
            except Exception as e:
                print(f"[Twitter] Click editor failed: {e}")
                # Try JS click as fallback
                await page.evaluate("document.querySelector('div[data-testid=\"tweetTextarea_0\"]').click()")
            await editor.fill(text_content)
            
            # 2. Attach Media
            if media_urls and len(media_urls) > 0:
                media_path = media_urls[0]
                print(f"[Twitter] 原始媒体路径: {media_path}")
                
                # Resolve local path if it's a URL or relative path
                filename = os.path.basename(media_path)
                # Remove URL query parameters if present
                if "?" in filename:
                    filename = filename.split("?")[0]
                    
                root_dir = self.get_project_root()
                original_root = os.environ.get("ORIGINAL_PROJECT_DIR", root_dir)
                
                possible_paths = [
                    media_path,
                    os.path.join(original_root, "storage/outputs", filename),
                    os.path.join(original_root, "storage/uploads", filename),
                    os.path.join(original_root, filename),
                    os.path.join(root_dir, "storage/outputs", filename),
                    os.path.join(root_dir, "storage/uploads", filename),
                    os.path.join(root_dir, filename)
                ]
                
                final_path = None
                for p in possible_paths:
                    if os.path.exists(p) and os.path.isfile(p):
                        final_path = p
                        print(f"[Twitter] 找到本地文件: {final_path}")
                        break
                
                if final_path:
                    print(f"[Twitter] 正在附加媒体文件: {final_path}")
                    # Use .first to avoid strict mode violation
                    file_input = page.locator('input[data-testid="fileInput"]').first
                    await file_input.set_input_files(final_path)
                    # Wait for upload to complete - increase wait time for images
                    await asyncio.sleep(8)
                else:
                    print(f"[Twitter] ❌ 无法找到媒体文件，跳过媒体上传。尝试过的路径: {possible_paths}")
                    # Do NOT try to upload the raw string if it's not a file, it might break the UI
                    pass 
            
            # 3. Post
            print("[Twitter] 点击发布按钮...")
            post_btn = page.locator('button[data-testid="tweetButton"]').first
            
            # Wait for button to be clickable (media upload might take time)
            try:
                await post_btn.wait_for(state="visible", timeout=30000)
                # Wait a bit more for disabled state to clear if media is processing
                for _ in range(10): 
                    if await post_btn.is_enabled():
                        break
                    await asyncio.sleep(1)
            except Exception as e:
                print(f"[Twitter] Wait for publish button failed: {e}")

            if await post_btn.is_enabled():
                try:
                    # Small delay to ensure UI is stable
                    await asyncio.sleep(2)
                    print(f"[Twitter] Attempting to click button (Visible: {await post_btn.is_visible()})")
                    await post_btn.click(force=True, timeout=5000)
                except Exception as e:
                    print(f"[Twitter] Click publish button failed: {e}")
                    # Try JS click as fallback
                    await page.evaluate("document.querySelector('button[data-testid=\"tweetButton\"]').click()")
                print("[Twitter] 发布按钮已点击")
                
                # Check outcome
                await asyncio.sleep(5)
                current_url = page.url
                print(f"[Twitter] Post-click URL: {current_url}")
                
                if "compose/post" not in current_url:
                     print("[Twitter] URL change detected, assuming success.")
                     await browser.close()
                     return PublishResult(success=True, platform=self.platform_id, post_id="twitter_web_post")
                
                # If URL didn't change, try keyboard shortcut as fallback
                print("[Twitter] URL did not change, evaluating fallback submission (Cmd+Enter)...")
                editor = page.locator('div[data-testid="tweetTextarea_0"]').first
                await editor.press("Meta+Enter")
                await asyncio.sleep(5)
                
                if "compose/post" not in page.url:
                     print("[Twitter] URL change detected after keyboard shortcut.")
                     await browser.close()
                     return PublishResult(success=True, platform=self.platform_id, post_id="twitter_web_post")

                # Final check for toast
                if await page.locator('text="Your post was sent"').count() > 0 or await page.locator('text="View"').count() > 0:
                    print("[Twitter] 发布成功！")
                    
                    # Save cookies for next time
                    try:
                        all_cookies = await context.cookies()
                        with open(cookie_file, "w") as f:
                            json.dump(all_cookies, f)
                    except Exception as e:
                        print(f"[Twitter] Cookie save warning: {e}")
                        
                    await browser.close()
                    return PublishResult(success=True, platform=self.platform_id, post_id="twitter_web_post")
                else:
                    # Catch-all success check if prompt didn't appear but we are back on home/profile
                    if "compose/post" not in page.url:
                        print("[Twitter] 发布似乎成功 (页面已跳转)")
                        await browser.close()
                        return PublishResult(success=True, platform=self.platform_id, post_id="twitter_web_post")
            
            print(f"[Twitter] 发布失败，最终页面状态: {await page.title()}")
            # Capture some debug info about why button might be disabled
            debug_text = "N/A"
            try:
                if await post_btn.is_visible():
                    is_enabled = await post_btn.is_enabled()
                    debug_text = f"Button visible, enabled={is_enabled}"
                else:
                    debug_text = "Button not visible"
            except:
                pass
                
            await browser.close()
            return PublishResult(success=False, platform=self.platform_id, error=f"发布失败或按钮不可用 (Debug: {debug_text})")

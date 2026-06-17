"""
YouTube Connector
YouTube 平台连接器
"""

import os
import time
import asyncio
import json
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class YouTubeConnector(BaseConnector):
    """
    YouTube 连接器 (Playwright 模拟)
    """
    
    @property
    def platform_name(self) -> str:
        return "YouTube"
    
    @property
    def required_credentials(self) -> List[str]:
        # YouTube usually uses multiple cookies: SID, HSID, SSID, APISID, SAPISID, LOGIN_INFO etc.
        return ["LOGIN_INFO"]
    
    async def verify_connection(self) -> bool:
        return "LOGIN_INFO" in self.credentials

    async def get_account_info(self) -> Dict[str, Any]:
        return {"username": self.credentials.get("username", "YouTube Creator"), "uid": ""}

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
        发布视频到 YouTube Studio
        """
        if content_type != "video":
            return PublishResult(success=False, platform=self.platform_id, error="YouTube connector only supports video currently")

        video_path = media_urls[0] if media_urls else None
        if not video_path:
            return PublishResult(success=False, platform=self.platform_id, error="No video_path provided")

        from playwright.async_api import async_playwright
        root_dir = self.get_project_root()
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
        
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
            
            # Load cookies
            cookie_file = os.path.join(root_dir, "youtube_cookies.json")
            if os.path.exists(cookie_file):
                with open(cookie_file, "r") as f:
                    saved_cookies = json.load(f)
                    await context.add_cookies(saved_cookies)
            
            # Add from credentials
            target_cookies = []
            for name, value in self.credentials.items():
                if name.isupper() or name in ["__Secure-3PSID", "LOGIN_INFO", "SID"]:
                    target_cookies.append({
                        "name": name,
                        "value": value,
                        "domain": ".youtube.com",
                        "path": "/"
                    })
            if target_cookies:
                await context.add_cookies(target_cookies)

            page = await context.new_page()
            
            print("[YouTube] 正在进入 YouTube Studio...")
            # Use the direct upload URL if possible
            await page.goto("https://studio.youtube.com", timeout=60000)
            
            # Login check
            try:
                await page.wait_for_selector('#avatar-btn, #create-icon', timeout=20000)
            except:
                if await page.locator('text="Use another account"').count() > 0 or "accounts.google.com" in page.url:
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="Google login required / Session expired")

            print("[YouTube] 点击上传按钮...")
            create_btn = page.locator('#create-icon').first
            await create_btn.click()
            await page.locator('text="Upload videos"').first.click()
            
            print("[YouTube] 正在选择文件...")
            file_input = page.locator('input[type="file"]')
            await file_input.set_input_files(video_path)
            
            # 1. Details Step
            print("[YouTube] 正在填写视频详情...")
            await page.wait_for_selector('#textbox[aria-label*="Description"]', timeout=30000)
            
            # Title
            title_box = page.locator('#textbox[aria-label*="Title"]').first
            await title_box.click()
            await title_box.press("Control+A")
            await title_box.press("Backspace")
            await title_box.fill(title or os.path.basename(video_path))
            
            # Description
            desc_box = page.locator('#textbox[aria-label*="Description"]').first
            await desc_box.click()
            await desc_box.fill(str(content))
            
            # Kids audience
            print("[YouTube] 设置受众群体...")
            kids_radio = page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MADE_FOR_KIDS"]')
            await kids_radio.scroll_into_view_if_needed()
            await kids_radio.click()
            
            # Next -> Elements
            print("[YouTube] 下一步: 视频元素...")
            await page.locator('#next-button').click()
            await asyncio.sleep(2)
            
            # Next -> Checks
            print("[YouTube] 下一步: 检查...")
            await page.locator('#next-button').click()
            await asyncio.sleep(2)
            
            # Next -> Visibility
            print("[YouTube] 下一步: 可见性...")
            await page.locator('#next-button').click()
            await asyncio.sleep(2)
            
            # Select Publicity
            print("[YouTube] 设置为公开发布...")
            public_radio = page.locator('tp-yt-paper-radio-button[name="PUBLIC"]')
            await public_radio.click()
            
            # Final Done/Publish
            print("[YouTube] 点击发布按钮...")
            done_btn = page.locator('#done-button')
            await done_btn.click()
            
            # Wait for success
            await asyncio.sleep(5)
            print("[YouTube] 发布完成！")
            
            # Save cookies
            all_cookies = await context.cookies()
            with open(cookie_file, "w") as f:
                json.dump(all_cookies, f)
            
            await browser.close()
            return PublishResult(success=True, platform=self.platform_id, post_id="youtube_web_upload")

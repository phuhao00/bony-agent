"""
WeChat Video Channel Connector
视频号平台连接器
"""

import os
import time
import asyncio
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class VideoChannelConnector(BaseConnector):
    """
    视频号连接器
    """
    
    @property
    def platform_name(self) -> str:
        return "视频号"
    
    @property
    def required_credentials(self) -> List[str]:
        return [] # Cookie file usually
    
    async def verify_connection(self) -> bool:
        return True

    async def get_account_info(self) -> Dict[str, Any]:
        return {"username": "视频号用户", "uid": ""}

    async def publish_content(self, content_type: str, title: str, content: str, media_urls: List[str] = None, options: Dict[str, Any] = None) -> PublishResult:
        if content_type != "video":
             return PublishResult(success=False, platform=self.platform_id, error="只支持视频发布")
            
        if not media_urls:
            return PublishResult(success=False, platform=self.platform_id, error="No media")
            
        video_path = media_urls[0]
        root_dir = self.get_project_root()
        filename = os.path.basename(video_path)
        
        # 增强路径解析
        search_paths = [
            video_path,
            os.path.join(root_dir, "storage/uploads", filename),
            os.path.join(root_dir, "storage/outputs", filename),
        ]
        
        final_video_path = None
        for p in search_paths:
            if os.path.exists(p):
                final_video_path = p
                print(f"[VideoChannel] 找到文件: {p}")
                break
        
        if final_video_path:
            video_path = final_video_path
        else:
             return PublishResult(success=False, platform=self.platform_id, error=f"文件不存在: {search_paths}")

        print(f"[VideoChannel] Publishing {video_path}")
        
        try:
            from playwright.async_api import async_playwright
            
            # Use dynamic absolute path for browsers
            root_dir = self.get_project_root()
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
            # Determine local storage dir for temporary artifacts
            local_tmp = os.path.join(root_dir, "storage", "temp")
            os.makedirs(local_tmp, exist_ok=True)
            
            # 搜索可能的浏览器路径 (优先使用 headless-shell 以稳定性)
            possible_paths = [
                # 1. Chrome Headless Shell (chromium_headless_shell-1208)
                os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
                # 2. Google Chrome for Testing (chromium-1208)
                os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
            ]
            
            browser_path = None
            for p_path in possible_paths:
                if os.path.exists(p_path):
                    browser_path = p_path
                    print(f"[VideoChannel] 找到浏览器可执行文件: {p_path}")
                    break

            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    executable_path=browser_path if browser_path else None,
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
                        '--no-crash-upload'
                    ]
                )
                context = await browser.new_context()
                
                cookies = []
                for key, value in self.credentials.items():
                    cookies.append({
                        "name": key,
                        "value": value,
                        "domain": ".qq.com",
                        "path": "/"
                    })
                await context.add_cookies(cookies)
                
                page = await context.new_page()
                await page.goto("https://channels.weixin.qq.com/platform/post/create")
                
                try:
                    await page.wait_for_url("https://channels.weixin.qq.com/platform/post/create", timeout=10000)
                except:
                     await browser.close()
                     return PublishResult(success=False, platform=self.platform_id, error="Login expired")

                # Upload
                upload_input = page.locator('input[type="file"]')
                await upload_input.set_input_files(video_path)
                
                # Wait for upload completion (check if delete button appears)
                # Logic from reference
                for _ in range(60):
                     # If "发表" button is not disabled, it's ready?
                     btn = page.locator('div.form-btns button:has-text("发表")')
                     if await btn.count() > 0 and not await btn.is_disabled():
                         break
                     await asyncio.sleep(2)

                # Title
                await page.locator("div.input-editor").click()
                await page.keyboard.type(title)
                
                # Publish
                btn = page.locator('div.form-btns button:has-text("发表")')
                await btn.click()
                
                # Wait for success
                # Logic: wait for redirect to post/list
                try:
                    await page.wait_for_url("**/post/list", timeout=10000)
                    await browser.close()
                    return PublishResult(success=True, platform=self.platform_id)
                except:
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="Upload timeout")

        except Exception as e:
            return PublishResult(success=False, platform=self.platform_id, error=str(e))

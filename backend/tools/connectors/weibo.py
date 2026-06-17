
"""
Weibo Connector
微博平台连接器
"""

import os
import time
import asyncio
import json
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class WeiboConnector(BaseConnector):
    """
    微博连接器
    """
    
    @property
    def platform_name(self) -> str:
        return "Weibo"
    
    @property
    def required_credentials(self) -> List[str]:
        # Weibo uses SUB cookie
        return ["SUB"]
    
    async def verify_connection(self) -> bool:
        return "SUB" in self.credentials

    async def get_account_info(self) -> Dict[str, Any]:
        return {"username": self.credentials.get("username", "Weibo User"), "uid": ""}

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
        发布内容到微博
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
                if name in ["SUB", "SUBP", "ALF", "SSOLoginState"]: 
                    cookies.append({
                        "name": name,
                        "value": str(value),
                        "domain": ".weibo.com",
                        "path": "/"
                    })
            
            # Check for weibo_cookies.json
            cookie_file = os.path.join(root_dir, "weibo_cookies.json")
            if os.path.exists(cookie_file):
                try:
                    with open(cookie_file, "r") as f:
                        saved_cookies = json.load(f)
                        await context.add_cookies(saved_cookies)
                except Exception as e:
                    print(f"[Weibo] Load saved cookies failed: {e}")
            
            if cookies:
                await context.add_cookies(cookies)

            page = await context.new_page()
            
            print("[Weibo] 正在打开微博主页...")
            await page.goto("https://weibo.com", timeout=60000)
            
            # Check login
            try:
                # Wait for the main composer text area
                await page.wait_for_selector('textarea.Form_input_3JXAD, textarea', timeout=15000)
            except:
                if await page.locator('text="登录"').count() > 0 or await page.locator('text="注册"').count() > 0:
                    await browser.close()
                    return PublishResult(success=False, platform=self.platform_id, error="未登录或会话已过期")
            
            # 1. Fill Text Content
            print(f"[Weibo] 填写微博内容: {text_content[:30]}...")
            # Try to find the composer
            editor = None
            try:
                # Regular home page composer
                editor = page.locator('textarea.Form_input_3JXAD').first
                if not await editor.count():
                    editor = page.locator('textarea').first
                
                await editor.click(force=True)
                await editor.fill(text_content)
            except Exception as e:
                print(f"[Weibo] Click editor failed: {e}")
                
            # 2. Attach Media
            if media_urls and len(media_urls) > 0:
                media_path = media_urls[0]
                print(f"[Weibo] 原始媒体路径: {media_path}")
                
                # Resolve local path
                filename = os.path.basename(media_path)
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
                        print(f"[Weibo] 找到本地文件: {final_path}")
                        break
                
                if final_path:
                    print(f"[Weibo] 正在附加媒体文件: {final_path}")
                    # Find file input - Weibo usually handles this via an input that might be hidden
                    # Typical Strategy: Find the upload button, but set input files on the hidden input
                    
                    try:
                        # Weibo often has input[type="file"] hidden in the tool bar
                        file_input = page.locator('input[type="file"]').first
                        await file_input.set_input_files(final_path)
                        await asyncio.sleep(8) # Wait for upload
                    except Exception as e:
                        print(f"[Weibo] Media upload failed: {e}")
                else:
                    print(f"[Weibo] ❌ 无法找到媒体文件，跳过媒体上传。")

            # 3. Post
            print("[Weibo] 点击发布按钮...")
            # Button often has text "发送" or "发布"
            post_btn = page.locator('button.Tool_btn_2E2SE:has-text("发送")').first
            if not await post_btn.count():
                 post_btn = page.locator('button:has-text("发送")').first
            if not await post_btn.count():
                 post_btn = page.locator('button:has-text("发布")').first
            
            # Wait for button to be enabled
            try:
                await post_btn.wait_for(state="visible", timeout=10000)
                # Quick check if enabled
                for _ in range(5):
                    if await post_btn.is_enabled():
                        break
                    await asyncio.sleep(1)
            except:
                pass

            if await post_btn.is_enabled():
                try:
                    await asyncio.sleep(1)
                    await post_btn.click(force=True, timeout=5000)
                except Exception as e:
                    print(f"[Weibo] Click publish button failed: {e}")
                    # Try JS click
                    await page.evaluate("arguments[0].click();", await post_btn.element_handle())
                
                print("[Weibo] 发布按钮已点击")
                
                # Check outcome
                await asyncio.sleep(5)
                # Success usually clears the editor or shows a new post in the stream
                # A simple check: did the editor clear?
                editor_val = await editor.input_value()
                if not editor_val:
                    print("[Weibo] 编辑器已清空，假设发布成功")
                    await browser.close()
                    return PublishResult(success=True, platform=self.platform_id, post_id="weibo_web_post")
                
                # Or check for toast?
                
            else:
                 print("[Weibo] 发布按钮不可用")
            
            await browser.close()
            # If we got here, maybe success wasn't detected or it failed
            # Since Weibo is tricky, let's assume if we clicked and didn't crash, and editor cleared, it's good.
            # But if editor content remains, it failed.
            if editor and not await editor.input_value():
                 return PublishResult(success=True, platform=self.platform_id, post_id="weibo_web_post")
            
            return PublishResult(success=False, platform=self.platform_id, error="发布失败或按钮不可用")

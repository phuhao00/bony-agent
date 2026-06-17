"""
Xiaohongshu Connector
小红书平台连接器
"""

import aiohttp
import json
import os
import time
import asyncio
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult

class XiaohongshuConnector(BaseConnector):
    """
    小红书连接器
    """
    
    @property
    def platform_name(self) -> str:
        return "小红书"
    
    @property
    def required_credentials(self) -> List[str]:
        return ['a1'] 
    
    def validate_credentials(self) -> bool:
        # 极度宽容模式：只要有一定数量的 Cookie 且包含 a1 或其它关键标识，就允许保存
        if not self.credentials:
            return False
        has_a1 = 'a1' in self.credentials
        cookie_count = len(self.credentials)
        return has_a1 or cookie_count > 10

    async def verify_connection(self) -> bool:
        """
        验证小红书登录状态
        尝试调用个人信息接口，判断 Cookie 是否仍然有效
        """
        if not self.validate_credentials():
            return False
            
        try:
            async with aiohttp.ClientSession() as session:
                # 小红书创作中心的一个基础信息接口
                url = "https://creator.xiaohongshu.com/api/sns/web/v1/user/info"
                # 注入 Cookies 到 headers
                cookie_parts = [f"{k}={v}" for k, v in self.credentials.items()]
                headers = {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Cookie": "; ".join(cookie_parts),
                    "Referer": "https://creator.xiaohongshu.com/publish/publish"
                }
                async with session.get(url, headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # success=True 表示有效
                        return data.get('success') is True
                    return False
        except Exception as e:
            print(f"Xiaohongshu connection verification error: {e}")
            # 如果请求出错，保留 validate_credentials 的结果作为兜底
            return self.validate_credentials()

    async def get_account_info(self) -> Dict[str, Any]:
        return {
            "username": "小红书用户",
            "uid": ""
        }

    async def publish_content(self, content_type: str, title: str, content: str, media_urls: List[str] = None, options: Dict[str, Any] = None) -> PublishResult:
        """
        发布内容到小红书 (增强版)
        支持: image (图文笔记) / video (视频笔记) / mixed (自动识别)
        """
        if content_type == "mixed" and media_urls:
            content_type = self._detect_content_type(media_urls)
            print(f"[XHS] 智能识别 mixed -> {content_type}")

        if content_type == "image":
            return await self._publish_image_note(title, content, media_urls)
        elif content_type == "video":
            if not media_urls:
                return PublishResult(success=False, platform=self.platform_id, error="未提供视频路径")
            return await self._publish_video_note(title, content, media_urls)
        else:
            return PublishResult(success=False, platform=self.platform_id, error=f"不支持的内容类型: {content_type}")

    async def _publish_image_note(self, title: str, content: str, media_urls: List[str] = None) -> PublishResult:
        """发布图文笔记到小红书"""
        root_dir = self.get_project_root()
        debug_dir = os.path.join(root_dir, "storage", "debug")
        os.makedirs(debug_dir, exist_ok=True)

        # 解析图片路径
        image_path = None
        if media_urls:
            for p in media_urls:
                if p and os.path.exists(p):
                    image_path = p
                    break
        
        try:
            from playwright.async_api import async_playwright
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
            possible_paths = [
                os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
                os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
            ]
            browser_path = next((p for p in possible_paths if os.path.exists(p)), None)

            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    executable_path=browser_path if (browser_path and os.path.exists(browser_path)) else None,
                    args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
                )
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    viewport={"width": 1440, "height": 900}
                )
                # 注入 Cookies
                cookies = [{"name": k, "value": v, "domain": ".xiaohongshu.com", "path": "/"} for k, v in self.credentials.items()]
                await context.add_cookies(cookies)
                page = await context.new_page()

                # 打开图文发布页
                await page.goto("https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image")
                await asyncio.sleep(3)

                # 上传图片
                if image_path:
                    print(f"[XHS] 上传图片: {image_path}")
                    upload_input = page.locator("input[type='file']").first
                    if await upload_input.count() > 0:
                        await upload_input.set_input_files(image_path)
                        await asyncio.sleep(5)  # 等待上传
                
                # 填写标题
                title_input = page.locator('input[placeholder*="标题"], .title-input input').first
                if await title_input.count() > 0:
                    await title_input.fill(title[:20])

                # 填写正文（caption）
                editor = page.locator('.ql-editor, div[contenteditable="true"]').first
                if await editor.count() > 0:
                    await editor.click()
                    await page.keyboard.press("Control+A")
                    await page.keyboard.type(content[:500], delay=30)

                await asyncio.sleep(2)
                await page.screenshot(path=os.path.join(debug_dir, "xhs_image_before_publish.png"))

                # 点击发布
                publish_btn = None
                for sel in ['button:has-text("发布")', '.publishBtn', '.submit-btn', '.footer button']:
                    b = page.locator(sel).first
                    if await b.count() > 0 and await b.is_visible():
                        publish_btn = b
                        break

                if publish_btn:
                    await publish_btn.click()
                    print(f"[XHS] 已点击发布")
                    try:
                        await page.wait_for_url("**/manage**", timeout=30000)
                        url = page.url
                        await browser.close()
                        return PublishResult(success=True, platform=self.platform_id, url=url)
                    except:
                        await page.screenshot(path=os.path.join(debug_dir, "xhs_image_after_publish.png"))
                        body = await page.inner_text('body')
                        if any(kw in body for kw in ["发布成功", "审核中", "笔记管理"]):
                            await browser.close()
                            return PublishResult(success=True, platform=self.platform_id)

                await page.screenshot(path=os.path.join(debug_dir, "xhs_image_error.png"))
                await browser.close()
                return PublishResult(success=False, platform=self.platform_id, error="图文发布未成功，请检查 debug 截图")
        except Exception as e:
            print(f"[XHS] 图文发布异常: {e}")
            return PublishResult(success=False, platform=self.platform_id, error=str(e))

    async def _publish_video_note(self, title: str, content: str, media_urls: List[str]) -> PublishResult:
        """发布视频笔记 (原有逻辑)"""
        video_path = media_urls[0]
        root_dir = self.get_project_root()
        filename = os.path.basename(video_path)
        
        # 增强路径解析：尝试多个可能的存放位置
        search_paths = [
            video_path, # 原始路径
            os.path.join(root_dir, "storage/uploads", filename),
            os.path.join(root_dir, "storage/outputs", filename),
        ]
        
        final_video_path = None
        for p in search_paths:
            if os.path.exists(p):
                final_video_path = p
                print(f"[XHS] 找到文件: {p}")
                break
        
        if final_video_path:
            video_path = final_video_path
        else:
             print(f"[XHS] 警告: 无法找到视频文件，尝试过的路径: {search_paths}")
             return PublishResult(success=False, platform=self.platform_id, error=f"文件不存在，尝试路径: {search_paths}")

        print(f"[XHS] 准备发布视频: {video_path}")
        
        try:
            from playwright.async_api import async_playwright
            
            # 确保使用正确的浏览器路径
            # Use dynamic absolute path for browsers
            root_dir = self.get_project_root()
            os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(root_dir, ".browsers")
            
            # 搜索可能的浏览器路径 (优先使用 headless-shell 以稳定性)
            possible_paths = [
                # 1. Chrome Headless Shell (chromium_headless_shell-1208)
                os.path.join(root_dir, ".browsers", "chromium_headless_shell-1208", "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
                # 2. Google Chrome for Testing (chromium-1208)
                os.path.join(root_dir, ".browsers", "chromium-1208", "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
            ]
            
            browser_path = None
            for p in possible_paths:
                if os.path.exists(p):
                    browser_path = p
                    print(f"[XHS] 找到浏览器可执行文件: {p}")
                    break
            debug_dir = os.path.join(root_dir, "storage", "debug")
            os.makedirs(debug_dir, exist_ok=True)
            tmp_local_dir = os.path.join(root_dir, "storage", "temp")
            os.makedirs(tmp_local_dir, exist_ok=True)
            
            async with async_playwright() as p:
                print(f"[XHS] 正在启动浏览器: {browser_path}")
                browser = await p.chromium.launch(
                    executable_path=browser_path if (browser_path and os.path.exists(browser_path)) else None,
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
                # 使用更大的视窗以便完整显示 UI
                context = await browser.new_context(
                    user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    viewport={"width": 1440, "height": 900}
                )
                
                # 注入 Cookies
                cookies = []
                for key, value in self.credentials.items():
                    cookies.append({
                        "name": key,
                        "value": value,
                        "domain": ".xiaohongshu.com",
                        "path": "/"
                    })
                await context.add_cookies(cookies)
                
                page = await context.new_page()
                
                # 访问发布页
                target_url = "https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video"
                print(f"[XHS] 正在打开发布页...")
                await page.goto(target_url)
                
                # 简单检查登录
                try:
                    await page.wait_for_selector('.upload-input, .upload-container', timeout=10000)
                except:
                    if await page.get_by_text('登录').count() > 0:
                        await browser.close()
                        return PublishResult(success=False, platform=self.platform_id, error="未登录或Cookie失效")

                # 1. 上传视频
                print("[XHS] 正在上传视频...")
                upload_input = page.locator("input[type='file']").first
                await upload_input.set_input_files(video_path)
                
                # 2. 等待上传完成
                print("[XHS] 等待上传中...")
                upload_done = False
                for _ in range(60): # 等待 120秒
                    # 检查是否有预览图或‘重新上传’字样
                    body_text = await page.inner_text('body')
                    if "上传成功" in body_text or "重新上传" in body_text:
                        print("[XHS] 视频上传完成！")
                        upload_done = True
                        break
                    await asyncio.sleep(2)
                
                if not upload_done:
                    print("[XHS] 警告: 未探测到上传成功标志，尝试继续...")

                await asyncio.sleep(2)

                # 3. 填写标题和内容
                print(f"[XHS] 填写标题: {title}")
                # 找到标题输入框
                title_box = page.locator('.title-input input, .d-text, input[placeholder*="标题"]').first
                if await title_box.count() > 0:
                    await title_box.fill(title[:20])
                
                print("[XHS] 填写描述...")
                # 小红书使用 Quill 编辑器
                print("[XHS] 尝试填写描述正文...")
                try:
                    # 1. 确保编辑器可见并聚焦
                    editor_selectors = ['.ql-editor', 'div[contenteditable="true"]', '#post-textarea', '.content-input .editor']
                    editor = None
                    for sel in editor_selectors:
                        el = page.locator(sel).first
                        if await el.count() > 0 and await el.is_visible():
                            editor = el
                            break
                    
                    if editor:
                        await editor.scroll_into_view_if_needed()
                        await editor.click()
                        await asyncio.sleep(1)
                        # 2. 清空并输入 (模拟真实输入)
                        await page.keyboard.press("Meta+A") # Mac 常用 Meta (Command)
                        await page.keyboard.press("Control+A") # 备用
                        await page.keyboard.press("Backspace")
                        await page.keyboard.type(f"{content}", delay=50)
                        
                        # 3. 如果输入后仍然为空，强制 JS 写入
                        val = await editor.inner_text()
                        if not val.strip():
                             print("[XHS] 键盘输入似乎未生效，尝试 JS 强制写入")
                             await page.evaluate('''(content) => { 
                                 const el = document.querySelector(".ql-editor") || document.querySelector("div[contenteditable='true']");
                                 if (el) {
                                     el.innerHTML = "<p>" + content.replace(/\\n/g, "</p><p>") + "</p>";
                                     el.dispatchEvent(new Event("input", { bubbles: true }));
                                 }
                             }''', content)
                    else:
                        print("[XHS] 未找到编辑器元素")
                except Exception as e:
                    print(f"[XHS] 填写描述异常: {e}")
                
                # 封面设置 (可选，默认使用视频第一帧)
                print("[XHS] 检查封面状态...")
                await asyncio.sleep(3)
                
                # 处理可能出现的弹窗 (如：试试文字配图吧)
                print("[XHS] 尝试清理弹窗...")
                for _ in range(3):
                    try:
                        await page.keyboard.press("Escape")
                        # 尝试寻找关闭按钮
                        close_btns = page.locator('svg.close, .close-icon, [class*="close"], button:has-text("关闭")')
                        if await close_btns.count() > 0:
                            await close_btns.first.click(timeout=1000)
                        await asyncio.sleep(0.5)
                    except:
                        pass

                # 4. 发布
                print("[XHS] 准备点击发布按钮...")
                # 尝试多种选择器定位发布按钮
                publish_btn = None
                selectors = [
                    'button:has-text("发布")',
                    '.publishBtn',
                    '.submit-btn',
                    'button.css-8f6p0z', # 某些版本的 CSS 类
                    '.footer button'
                ]
                for sel in selectors:
                    b = page.locator(sel).first
                    if await b.count() > 0 and await b.is_visible():
                        publish_btn = b
                        break

                if publish_btn:
                    await page.screenshot(path=os.path.join(debug_dir, "xhs_before_publish.png"))
                    print("[XHS] 按钮已就绪，正在点击发布...")
                    await publish_btn.click()
                    print(f"[XHS] 已点击发布，当前 URL: {page.url}")
                    
                    # 备用点击逻辑 (防止按钮被遮挡或需要强力点击)
                    await asyncio.sleep(1)
                    if await publish_btn.is_visible():
                         try: await publish_btn.click(force=True)
                         except: pass

                    # 等待成功跳转或结果
                    print("[XHS] 等待跳转或成功提示...")
                    try:
                        # 增加超时，小红书发布后可能需要时间处理
                        await page.wait_for_url("**/manage**", timeout=30000)
                        print(f"[XHS] 发布成功！跳转到了管理页: {page.url}")
                        await browser.close()
                        return PublishResult(success=True, platform=self.platform_id, url=page.url)
                    except:
                        # 备用：检查页面状况
                        await page.screenshot(path=os.path.join(debug_dir, "xhs_after_publish_check.png"))
                        print(f"[XHS] 未检测到 manage 跳转，当前 URL: {page.url}，检查页面内容...")
                        await asyncio.sleep(5)
                        body_text = await page.inner_text('body')
                        if any(kw in body_text for kw in ["发布成功", "审核中", "主页", "笔记管理", "去笔记管理"]):
                             print("[XHS] 检测到发布成功相关提示或界面")
                             await browser.close()
                             return PublishResult(success=True, platform=self.platform_id)
                
                # 如果走到这里，捕获截图定位问题
                await page.screenshot(path=os.path.join(debug_dir, "xhs_publish_error.png"))
                await browser.close()
                return PublishResult(success=False, platform=self.platform_id, error="发布未成功或未探测到成功状态")

        except Exception as e:
            print(f"[XHS] 发生异常: {e}")
            return PublishResult(success=False, platform=self.platform_id, error=str(e))

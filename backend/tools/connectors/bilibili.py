"""
Bilibili Connector
B站平台连接器 - 真实API实现
"""

import asyncio
import aiohttp
import hashlib
import time
import json
import os
from typing import Dict, Any, List, Optional
from .base import BaseConnector, PublishResult, ConnectorStatus


class BilibiliConnector(BaseConnector):
    """
    B站连接器
    使用 cookie/SESSDATA 进行认证
    """
    
    API_BASE = "https://api.bilibili.com"
    VC_API = "https://api.vc.bilibili.com"
    MEMBER_API = "https://member.bilibili.com"
    
    @property
    def platform_name(self) -> str:
        return "哔哩哔哩"
    
    @property
    def required_credentials(self) -> List[str]:
        return ['SESSDATA', 'bili_jct', 'DedeUserID']
    
    def _get_headers(self) -> Dict[str, str]:
        """构建请求头"""
        cookie_parts = []
        for key in ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'buvid3', 'buvid4']:
            if key in self.credentials:
                cookie_parts.append(f"{key}={self.credentials[key]}")
        
        return {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': '; '.join(cookie_parts),
            'Referer': 'https://www.bilibili.com',
            'Origin': 'https://www.bilibili.com'
        }
    
    async def verify_connection(self) -> bool:
        """验证B站登录状态"""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/x/web-interface/nav"
                async with session.get(url, headers=self._get_headers()) as resp:
                    data = await resp.json()
                    # code=0 表示已登录
                    return data.get('code') == 0 and data.get('data', {}).get('isLogin', False)
        except Exception as e:
            print(f"Bilibili connection verification failed: {e}")
            return False
    
    async def get_account_info(self) -> Dict[str, Any]:
        """获取B站账号信息"""
        try:
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/x/web-interface/nav"
                async with session.get(url, headers=self._get_headers()) as resp:
                    data = await resp.json()
                    if data.get('code') == 0:
                        user_data = data.get('data', {})
                        return {
                            'uid': user_data.get('mid'),
                            'username': user_data.get('uname'),
                            'face': user_data.get('face'),
                            'level': user_data.get('level_info', {}).get('current_level'),
                            'vip_status': user_data.get('vipStatus')
                        }
            return {}
        except Exception as e:
            print(f"Failed to get Bilibili account info: {e}")
            return {}
    
    async def publish_content(
        self,
        content_type: str,
        title: str,
        content: str,
        media_urls: List[str] = None,
        options: Dict[str, Any] = None
    ) -> PublishResult:
        """
        发布内容到B站动态
        """
        options = options or {}
        
        try:
            # Always prioritize video detection: if any media URL is a video,
            # override content_type regardless of what was passed in.
            if media_urls:
                detected = self._detect_content_type(media_urls)
                if detected == "video":
                    content_type = "video"
                    print(f"[Bilibili] 检测到视频 URL，强制切换为视频投稿模式")
                elif content_type in ("mixed", "text"):
                    content_type = detected
                    print(f"[Bilibili] 智能识别 -> {content_type}")

            if content_type == "video":
                # 尝试进行视频投稿 (Archive Submission)
                if media_urls and len(media_urls) > 0:
                    video_path = media_urls[0]
                    print(f"[Bilibili] 开始视频投稿流程: {video_path}")
                    
                    # 1. 上传视频
                    upload_result = await self._upload_video_file(video_path)
                    
                    if upload_result:
                        # 2. 提交稿件
                        print(f"[Bilibili] 视频上传成功，准备提交稿件: {upload_result['filename']}")
                        # 更加严格的长度限制，适配部分 B 站账号的低容忍度
                        # 稿件描述截断至 250 字，动态截断至 128 字
                        desc_text = (content or "")[:250]
                        submit_result = await self._submit_video_archive(
                            filename=upload_result['filename'],
                            title=(title or "AI生成视频")[:80],
                            desc=desc_text
                        )
                        return submit_result
                    else:
                        return PublishResult(
                            success=False,
                            platform=self.platform_id,
                            error="视频上传失败，无法投稿"
                        )
                else:
                    return PublishResult(
                        success=False,
                        platform=self.platform_id,
                        error="视频内容缺少媒体URL"
                    )
            
            # 发布图文动态 (支持 image, text, mixed)
            elif content_type in ["image", "text", "mixed"]:
                result = await self._publish_dynamic_real(title, content, media_urls)
                return result
                return PublishResult(
                    success=False,
                    platform=self.platform_id,
                    error=f"不支持的内容类型: {content_type}"
                )
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            return PublishResult(
                success=False,
                platform=self.platform_id,
                error=str(e)
            )

    async def _upload_video_file(self, video_path: str) -> Optional[Dict[str, Any]]:
        """
        上传视频文件到B站服务器
        返回: {"filename": "...", "title": "..."}
        """
        import os
        
        try:
            # 1. 准备文件
            root_dir = self.get_project_root()

            # 规范化路径 —— 处理 /api/media/xxx 等 Web 路径
            if video_path.startswith('/api/media/'):
                clean_name = video_path[len('/api/media/'):].split('?')[0]
                video_path = os.path.join(root_dir, 'storage', 'outputs', clean_name)
                print(f"[Bilibili] 将 /api/media/ URL 解析为本地路径: {video_path}")
            elif video_path.startswith('http') and 'storage/outputs' not in video_path:
                # 外部 CDN URL，先尝试下载到临时目录
                import urllib.request
                import urllib.parse
                clean_name = os.path.basename(urllib.parse.urlparse(video_path).path)
                if not clean_name.endswith('.mp4'):
                    clean_name += '.mp4'
                temp_path = os.path.join(root_dir, 'storage', 'temp', f'bili_dl_{clean_name}')
                os.makedirs(os.path.dirname(temp_path), exist_ok=True)
                print(f"[Bilibili] 下载外部视频: {video_path} -> {temp_path}")
                urllib.request.urlretrieve(video_path, temp_path)
                video_path = temp_path

            filename = os.path.basename(video_path)

            # 增强路径解析
            search_paths = [
                video_path,
                os.path.join(root_dir, "storage/uploads", filename),
                os.path.join(root_dir, "storage/outputs", filename),
            ]
            
            input_source = None
            for p in search_paths:
                if os.path.exists(p):
                    input_source = p
                    print(f"[Bilibili] 找到视频文件: {p}")
                    break
                    
            if not input_source:
                print(f"[Bilibili] 视频文件不存在，尝试路径: {search_paths}")
                return None
                
            file_name = os.path.basename(input_source)
            file_size = os.path.getsize(input_source)
            
            async with aiohttp.ClientSession() as session:
                # 2. 预上传 (Pre-upload)
                pre_upload_url = "https://member.bilibili.com/preupload"
                params = {
                    "name": file_name,
                    "size": file_size,
                    "r": "upos",
                    "profile": "ugcupos/bup",
                    "ssl": "0",
                    "version": "2.14.0.0",
                    "build": "2140000",
                    # "upcdn": "bda2", # 移除固定CDN，让B站自动分配
                    "probe_version": "20231011"
                }
                
                print(f"[Bilibili] 开始预上传: {file_name}")
                async with session.get(pre_upload_url, params=params, headers=self._get_headers()) as resp:
                    pre_data = await resp.json()
                    print(f"[Bilibili] 预上传响应: {pre_data}")
                    if 'upos_uri' not in pre_data:
                        print(f"[Bilibili] 预上传失败: {pre_data}")
                        return None
                        
                upos_uri = pre_data['upos_uri']
                upos_auth = pre_data['auth'] # 这是鉴权Token，不是uploadId
                biz_id = pre_data['biz_id']
                chunk_size = pre_data['chunk_size']
                
                # 获取最佳 endpoint
                endpoint = pre_data.get('endpoint', '')
                if not endpoint:
                     endpoint = "https://upos-sz-mirror08c.bilivideo.com"
                if endpoint.startswith('//'):
                    endpoint = 'https:' + endpoint
                
                # 构造上传 URL
                upload_path = upos_uri.replace('upos://', '')
                upload_url = f"{endpoint}/{upload_path}"
                
                print(f"[Bilibili] 上传URL: {upload_url}")
                
                # 2.5 初始化分块上传 (Initiate Multipart Upload)
                # 获取真正的 upload_id
                init_url = f"{upload_url}?uploads&output=json"
                print(f"[Bilibili] 初始化上传: {init_url}")
                
                async with session.post(init_url, headers={"X-Upos-Auth": upos_auth}) as init_resp:
                    if init_resp.status != 200:
                        print(f"[Bilibili] 初始化上传失败: {init_resp.status}")
                        return None
                    init_data = await init_resp.json()
                    real_upload_id = init_data.get('upload_id')
                    print(f"[Bilibili] 获取到 upload_id: {real_upload_id}")
                
                if not real_upload_id:
                     print("[Bilibili] 无法获取 upload_id")
                     return None

                # 3. 分块上传
                put_query = pre_data.get('put_query', '')
                
                with open(input_source, 'rb') as f:
                    chunks = []
                    total_chunks = (file_size + chunk_size - 1) // chunk_size
                    
                    for i in range(total_chunks):
                        chunk = f.read(chunk_size)
                        
                        # upload chunk
                        base_query = f"partNumber={i+1}&uploadId={real_upload_id}&chunks={total_chunks}&chunk={i}&size={len(chunk)}&start={i*chunk_size}&end={i*chunk_size+len(chunk)}&total={file_size}"
                        
                        if put_query:
                            put_url = f"{upload_url}?{put_query}&{base_query}"
                        else:
                            put_url = f"{upload_url}?{base_query}"
                        
                        async with session.put(put_url, data=chunk, headers={
                            "X-Upos-Auth": upos_auth,
                            "Content-Type": "application/octet-stream"
                        }) as put_resp:
                            if put_resp.status != 200:
                                resp_text = await put_resp.text()
                                print(f"[Bilibili] 分块 {i+1} 上传失败: {put_resp.status}, {resp_text}")
                                return None
                        
                        # 打印进度
                        if (i+1) % 5 == 0 or i == total_chunks - 1:
                            print(f"[Bilibili] 上传进度: {i+1}/{total_chunks}")
                            
                # 4. 确认上传 (Finish)
                finish_url = f"{upload_url}?output=json&name={file_name}&profile=ugcupos/bup&uploadId={real_upload_id}&biz_id={biz_id}"
                async with session.post(finish_url, headers={"X-Upos-Auth": upos_auth}) as finish_resp:
                    finish_data = await finish_resp.json()
                    print(f"[Bilibili] 上传完成: {finish_data}")
                    
                    if finish_data.get('OK') == 1 or 'OK' in finish_data.get('message', ''):
                        # 从 upos_uri 提取 filename (去掉 upos://ugcever/ 和 .mp4)
                        # upos_uri: upos://ugcever/n260128Sa217647g181w13u93o11t17c.mp4
                        server_filename = upos_uri.split('/')[-1].split('.')[0]
                        
                        return {
                            "filename": server_filename,
                            "title": file_name
                        }
                    else:
                        print(f"[Bilibili] 确认上传失败: {finish_data}")
                        return None
                        
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[Bilibili] 视频上传异常: {e}")
            return None

    async def _submit_video_archive(self, filename: str, title: str, desc: str, tag: str = "AI创作") -> PublishResult:
        """提交视频稿件"""
        try:
            csrf = self.credentials.get('bili_jct', '')
            
            # 使用简单的默认分区：生活 -> 搞笑 (138) 或者 动画 -> 短片 (27)
            # 为了通用，可以使用 科技 -> AI应用 (241)? 还是 知识 (201)?
            # 暂时使用 知识 -> 科学科普 (201) 或者 动画 -> 综合 (27)
            # 保险起见，用 生活 -> 日常 (21)
            tid = 21 
            
            # 辅助函数：清理无效 Unicode 字符
            def clean_text(text: str) -> str:
                if not text: return ""
                return text.encode('utf-8', errors='ignore').decode('utf-8')

            # 更加保守的长度管理 (有些账号限制非常严格)
            title = clean_text(title)[:80]
            desc = clean_text(desc)[:250] # 降低到 250，适配旧版 API 或受限账号
            tag = clean_text(tag)[:80]
            
            payload = {
                "copyright": 1, 
                "videos": [{
                    "filename": filename,
                    "title": title,
                    "desc": desc[:200] # P描述进一步缩减
                }],
                "source": "AI辅助创作",
                "tid": tid, 
                "cover": "", 
                "title": title,
                "tag": tag,
                "desc_format_id": 33,
                "desc": desc,
                "dynamic": title[:120], # 动态截断至 120 字，非常安全
                "interactive": 0,
                "csrf": csrf
            }
            
            # 更新 Headers 中的 Referer
            headers = self._get_headers()
            headers['Referer'] = 'https://member.bilibili.com/platform/upload/video/frame'
            headers['Origin'] = 'https://member.bilibili.com'
            
            async with aiohttp.ClientSession() as session:
                # CSRF token 有时需要同时在 Query String 和 Body 中
                url = f"{self.MEMBER_API}/x/vu/web/add?csrf={csrf}"
                print(f"[Bilibili] 提交稿件 URL: {url}")
                
                async with session.post(url, json=payload, headers=headers) as resp:
                    data = await resp.json()
                    print(f"[Bilibili] 提交稿件响应: {data}")
                    
                    if data.get('code') == 0:
                        bvid = data['data']['bvid']
                        return PublishResult(
                            success=True,
                            platform=self.platform_id,
                            post_id=str(bvid),
                            url=f"https://www.bilibili.com/video/{bvid}"
                        )
                    else:
                        return PublishResult(
                            success=False,
                            platform=self.platform_id,
                            error=f"稿件提交失败: {data.get('message')}"
                        )
                        
        except Exception as e:
            return PublishResult(
                success=False,
                platform=self.platform_id,
                error=f"稿件提交异常: {e}"
            )

    async def _extract_video_cover(self, video_path: str) -> Optional[str]:
        """使用ffmpeg提取视频第一帧作为封面"""
        import subprocess
        import tempfile
        
        try:
            # 使用项目根目录下的 storage/temp 目录，而不是系统 /tmp
            root_dir = self.get_project_root()
            temp_dir = os.path.join(root_dir, "storage", "temp")
            os.makedirs(temp_dir, exist_ok=True)
            
            cover_filename = f"bili_cover_{int(time.time())}.jpg"
            cover_path = os.path.join(temp_dir, cover_filename)
            
            # 处理URL或本地路径
            input_source = video_path
            
            # 如果是 /api/media/ 开头的路径，转换为本地绝对路径
            if video_path.startswith('/api/media/'):
                filename = video_path.replace('/api/media/', '')
                input_source = os.path.join(os.getcwd(), "storage/outputs", filename)
            elif video_path.startswith('http'):
                 # 远程URL，ffmpeg通常可以直接处理
                 pass

            # 调用 ffmpeg 截图
            # ffmpeg -i input.mp4 -ss 00:00:01 -vframes 1 output.jpg
            cmd = ['ffmpeg', '-y', '-i', input_source, '-ss', '00:00:00', '-vframes', '1', cover_path]
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate()
            
            if process.returncode == 0 and os.path.exists(cover_path) and os.path.getsize(cover_path) > 0:
                print(f"[Bilibili] 成功提取视频封面: {cover_path}")
                return cover_path
            else:
                print(f"[Bilibili] 封面提取失败: {stderr.decode()}")
                return None
                
        except Exception as e:
            print(f"[Bilibili] 封面提取异常: {e}")
            return None
    
    async def _upload_image(self, image_path: str) -> Optional[Dict[str, Any]]:
        """
        上传图片到B站
        返回: {"image_url": "...", "image_width": ..., "image_height": ...}
        """
        try:
            csrf = self.credentials.get('bili_jct', '')
            
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/x/dynamic/feed/draw/upload_bfs"
                
                # 处理不同类型的图片路径
                if image_path.startswith('http'):
                    # 从URL下载图片
                    async with session.get(image_path) as resp:
                        image_data = await resp.read()
                    filename = 'image.jpg'
                elif image_path.startswith('/api/media/'):
                    # 转换 /api/media/xxx.jpg 到实际路径
                    filename = image_path.replace('/api/media/', '')
                    root_dir = self.get_project_root()
                    actual_path = os.path.join(root_dir, "storage/outputs", filename)
                    print(f"[Bilibili] 转换路径: {image_path} -> {actual_path}")
                    with open(actual_path, 'rb') as f:
                        image_data = f.read()
                else:
                    # 本地文件路径
                    with open(image_path, 'rb') as f:
                        image_data = f.read()
                    filename = os.path.basename(image_path)
                
                # 构建 multipart form data
                form = aiohttp.FormData()
                form.add_field('file_up', image_data, filename=filename, content_type='image/jpeg')
                form.add_field('category', 'daily')
                form.add_field('biz', 'new_dyn')
                form.add_field('csrf', csrf)
                
                headers = self._get_headers()
                headers.pop('Content-Type', None)  # Let aiohttp set it
                
                async with session.post(url, data=form, headers=headers) as resp:
                    result = await resp.json()
                    print(f"[Bilibili] 图片上传响应: {result}")
                    
                    if result.get('code') == 0:
                        return result.get('data')
                    else:
                        print(f"[Bilibili] 图片上传失败: {result}")
                        return None
                        
        except Exception as e:
            print(f"[Bilibili] 图片上传异常: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    async def _publish_dynamic_real(
        self, 
        title: str, 
        content: str, 
        media_urls: List[str] = None
    ) -> PublishResult:
        """
        真实发布动态到B站
        使用最新的 API: https://api.bilibili.com/x/dynamic/feed/create/dyn
        """
        try:
            csrf = self.credentials.get('bili_jct', '')
            uid = self.credentials.get('DedeUserID', '')
            
            # 清理文本中的无效字符（surrogate characters）
            def clean_text(text: str) -> str:
                # 移除无效的 Unicode surrogate 字符
                return text.encode('utf-8', errors='ignore').decode('utf-8')
            
            # 构建动态文本（限制长度，B站动态最多约2000字）
            if title and content:
                dynamic_text = f"{clean_text(title)}\n\n{clean_text(content)}"
            elif title:
                dynamic_text = clean_text(title)
            else:
                dynamic_text = clean_text(content)
            
            # 截断过长的文本
            # 针对 4126115 错误采取更激进的策略：限制到 500 字
            MAX_LENGTH = 500  
            if len(dynamic_text) > MAX_LENGTH:
                dynamic_text = dynamic_text[:MAX_LENGTH] + "..."
                print(f"[Bilibili] 文本过长，强制截断到 {MAX_LENGTH} 字")
            
            # 上传图片（如果有）
            pics = []
            if media_urls:
                for url in media_urls[:9]:  # 最多9张图
                    print(f"[Bilibili] 上传图片: {url}")
                    img_info = await self._upload_image(url)
                    if img_info:
                        pics.append({
                            "img_src": img_info.get("image_url", ""),
                            "img_width": img_info.get("image_width", 1080),
                            "img_height": img_info.get("image_height", 1080),
                            "img_size": img_info.get("img_size", 100)
                        })
            
            # 构建请求体
            upload_id = f"{uid}_{int(time.time())}_{hash(content) % 10000}"
            
            dyn_req = {
                "content": {
                    "contents": [
                        {"raw_text": dynamic_text, "type": 1, "biz_id": ""}
                    ]
                },
                "scene": 2 if pics else 1,  # 2=带图, 1=纯文本
                "meta": {
                    "app_meta": {
                        "from": "create.dynamic.web",
                        "mobi_app": "web"
                    }
                },
                "upload_id": upload_id
            }
            
            if pics:
                dyn_req["pics"] = pics
            
            # 发送请求
            async with aiohttp.ClientSession() as session:
                url = f"{self.API_BASE}/x/dynamic/feed/create/dyn?csrf={csrf}"
                headers = self._get_headers()
                headers['Content-Type'] = 'application/json'
                
                try:
                    print(f"[Bilibili] 发布动态，文本长度: {len(dynamic_text)}, 图片数: {len(pics)}")
                except:
                    pass
                
                async with session.post(
                    url, 
                    json={"dyn_req": dyn_req},
                    headers=headers
                ) as resp:
                    result = await resp.json()
                    print(f"[Bilibili] 发布响应: {result}")
                    
                    if result.get('code') == 0:
                        dyn_data = result.get('data', {})
                        dyn_id = dyn_data.get('dyn_id_str') or dyn_data.get('dyn_id') or str(dyn_data.get('dynamic_id', ''))
                        
                        return PublishResult(
                            success=True,
                            platform=self.platform_id,
                            post_id=str(dyn_id),
                            url=f"https://t.bilibili.com/{dyn_id}",
                            metadata={"type": "dynamic", "pics_count": len(pics)}
                        )
                    else:
                        error_msg = result.get('message') or result.get('msg') or '发布失败'
                        return PublishResult(
                            success=False,
                            platform=self.platform_id,
                            error=f"B站返回错误: {error_msg} (code: {result.get('code')})"
                        )
                        
        except Exception as e:
            import traceback
            traceback.print_exc()
            return PublishResult(
                success=False,
                platform=self.platform_id,
                error=f"发布异常: {str(e)}"
            )

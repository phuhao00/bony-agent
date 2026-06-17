import sys
import os
import asyncio
from unittest.mock import MagicMock, AsyncMock

# 确保可以导入项目模块
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

from tools.connectors.douyin import DouyinConnector
from tools.connectors.xiaohongshu import XiaohongshuConnector
from tools.connectors.bilibili import BilibiliConnector

async def test_mixed_routing():
    print("=== 开始验证 mixed 类型路由逻辑 ===")
    
    # 模拟凭证
    creds = {"sessionid": "mock_dy", "a1": "mock_xhs", "SESSDATA": "mock_bili", "bili_jct": "mock_jct", "DedeUserID": "mock_uid"}
    
    # 1. 抖音验证
    dy = DouyinConnector("douyin", creds)
    # 现在我们可以直接 mock _publish_video 了
    dy._publish_video = AsyncMock(return_value=MagicMock(success=True))
    
    print("\n[抖音] 测试 mixed (含视频) -> 识别为 video")
    await dy.publish_content(
        content_type="mixed",
        title="测试",
        content="内容",
        media_urls=["test.mp4"]
    )
    print(f"调用了视频发布: {dy._publish_video.called}")
    
    # 2. 小红书验证
    xhs = XiaohongshuConnector("xiaohongshu", creds)
    xhs._publish_video_note = AsyncMock(return_value=MagicMock(success=True))
    xhs._publish_image_note = AsyncMock(return_value=MagicMock(success=True))
    
    print("\n[小红书] 测试 mixed (含视频) -> 优先视频")
    await xhs.publish_content(content_type="mixed", title="标题", content="内容", media_urls=["video.mp4", "img.jpg"])
    print(f"调用了视频发布: {xhs._publish_video_note.called}")
    
    print("[小红书] 测试 mixed (纯图片) -> 识别为图片")
    await xhs.publish_content(content_type="mixed", title="标题", content="内容", media_urls=["img.jpg"])
    print(f"调用了图片发布: {xhs._publish_image_note.called}")
    
    # 3. B站验证
    bili = BilibiliConnector("bilibili", creds)
    bili._upload_video_file = AsyncMock(return_value={"filename": "mock", "title": "mock"})
    bili._submit_video_archive = AsyncMock(return_value=MagicMock(success=True))
    bili._publish_dynamic_real = AsyncMock(return_value=MagicMock(success=True))
    
    print("\n[B站] 测试 mixed (含视频) -> 优先投稿视频")
    await bili.publish_content(content_type="mixed", title="标题", content="内容", media_urls=["v.mp4"])
    print(f"调用了视频投稿: {bili._submit_video_archive.called}")
    
    print("[B站] 测试 mixed (纯图片) -> 识别为动态")
    await bili.publish_content(content_type="mixed", title="标题", content="内容", media_urls=["p.jpg"])
    print(f"调用了动态发布: {bili._publish_dynamic_real.called}")

    print("\n=== 验证完成 ===")

if __name__ == "__main__":
    asyncio.run(test_mixed_routing())

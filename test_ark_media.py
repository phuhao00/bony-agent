import os
import requests
import json

api_key = "70c0bd3d-5255-4b7c-a93d-9fc2f1a8a163"
# 修正 endpoint: OpenAI 兼容的 images generations
endpoint = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
# 修正 endpoint: 视频生成可能也是 images/generations 或者 video/generations，Ark 文档通常说它是 OpenAI 兼容的
# 但视频生成 OpenAI 标准较新。

model_img = "doubao-seedream-5-0-260128"
model_vid = "doubao-seedance-2-0-260128"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

print(f"尝试调用图片生成模型: {model_img}")
payload = {
    "model": model_img,
    "prompt": "A futuristic city with flying cars, cyberpunk style",
    "size": "1024x1024"
}

try:
    resp = requests.post(endpoint, json=payload, headers=headers, timeout=60)
    print(f"Image Status: {resp.status_code}")
    if resp.status_code == 200:
        print("✅ 图片生成成功！")
        print(resp.json())
    else:
        print(f"❌ 图片生成失败: {resp.text}")
        
    print("-" * 30)
    
    # 尝试视频生成 (假设路径是 /api/v3/video/generations 或类似的，具体看 Ark 文档，但如果是 doubao-seedance，可能是私有协议)
    # 不过我们可以先试试 OpenAI 风格的 path
    vid_endpoint = "https://ark.cn-beijing.volces.com/api/v3/videos/generations" # 猜测
    print(f"尝试调用视频生成模型: {model_vid}")
    payload_vid = {
        "model": model_vid,
        "prompt": "A cat running in the garden, realistic style",
    }
    resp_vid = requests.post(vid_endpoint, json=payload_vid, headers=headers, timeout=60)
    print(f"Video Status: {resp_vid.status_code}")
    if resp_vid.status_code == 200:
        print("✅ 视频生成成功！")
        print(resp_vid.json())
    elif resp_vid.status_code == 404:
        # 试试 images endpoint 传 video model?
         print(f"❌ 视频 Endpoint 404，尝试使用 images endpoint...")
         payload_vid_img = {
            "model": model_vid, # 传视频模型 ID
            "prompt": "A cat running",
         }
         resp_retry = requests.post(endpoint, json=payload_vid_img, headers=headers)
         print(f"Retry Status: {resp_retry.status_code}")
         print(resp_retry.text[:200])
    else:
        print(f"❌ 视频生成失败: {resp_vid.text}")

except Exception as e:
    print(f"❌ 异常: {e}")

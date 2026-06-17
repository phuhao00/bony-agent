import os
import requests
import json

api_key = "70c0bd3d-5255-4b7c-a93d-9fc2f1a8a163"
endpoint = "https://ark.cn-beijing.volces.com/api/v3/models"

print(f"尝试使用 API Key 连接火山引擎 Ark (LLM)...")
headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

try:
    # 1. 查询模型列表
    print("正在查询可用模型/接入点...")
    resp = requests.get(endpoint, headers=headers, timeout=10)
    
    if resp.status_code == 200:
        data = resp.json()
        models = data.get("data", [])
        print(f"✅ 成功连接！找到 {len(models)} 个可用模型/接入点：")
        
        video_endpoints = []
        image_endpoints = []
        
        for m in models:
            mid = m.get("id", "")
            mw = m.get("owned_by", "")
            print(f" - ID: {mid:<30} | Owner: {mw}")
            
            # 简单猜测能力
            if "video" in mid.lower() or "cv" in mid.lower():
                video_endpoints.append(mid)
            if "image" in mid.lower() or "t2i" in mid.lower():
                image_endpoints.append(mid)
                
        print("-" * 50)
        if video_endpoints:
            print(f"🔍 发现可能的视频生成接入点: {video_endpoints}")
            print("👉 请将此 Endpoint ID 填入配置中。")
        else:
            print("⚠️ 未发现明显的视频生成接入点。")
            print("如果这是一个公共模型，可能需要使用具体的 Endpoint ID (例如 ep-2025...) 而不是模型名。")
            
    else:
        print(f"❌ 请求失败: {resp.status_code} - {resp.text}")

except Exception as e:
    print(f"❌ 发生异常: {e}")

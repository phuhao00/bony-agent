
import asyncio
import os
import sys
import json

project_root = "/Users/tutu/Documents/agent"
sys.path.append(project_root)

from backend.tools.connectors.kuaishou import KuaishouConnector

async def main():
    os.environ["ORIGINAL_PROJECT_DIR"] = project_root
    creds_file = os.path.join(project_root, "storage/outputs/credentials_store.json")
    with open(creds_file, 'r') as f:
        all_creds = json.load(f)
    ks_creds = all_creds.get("kuaishou", {})
    connector = KuaishouConnector("kuaishou", ks_creds)
    
    video_path = os.path.join(project_root, "storage/outputs/3b775a81-f13e-40e2-8f2a-648a5343b850.mp4")
    print(f"MAIN: Starting publish for {video_path}")
    
    result = await connector.publish_content(
        content_type="video",
        title="Test",
        content="Test content",
        media_urls=[video_path]
    )
    print(f"MAIN: Result: {result}")

if __name__ == "__main__":
    asyncio.run(main())

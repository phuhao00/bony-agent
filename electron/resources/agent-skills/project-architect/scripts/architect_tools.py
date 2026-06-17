import os
import shutil
from typing import List, Dict

def validate_structure():
    """验证项目结构是否符合规范"""
    required_dirs = [
        "backend/agents",
        "backend/tools",
        "backend/utils",
        "backend/core",
        "storage/outputs",
        "storage/uploads",
        ".agent/skills"
    ]
    
    results = {}
    for d in required_dirs:
        results[d] = os.path.exists(d)
    
    return results

def move_to_standard(src: str, category: str):
    """将非规范文件移动到规范目录"""
    mapping = {
        "agent": "backend/agents",
        "tool": "backend/tools",
        "util": "backend/utils",
        "output": "storage/outputs",
        "upload": "storage/uploads"
    }
    
    dest_dir = mapping.get(category)
    if not dest_dir:
        return f"Unknown category: {category}"
        
    if not os.path.exists(src):
        return f"Source not found: {src}"
    
    dest_path = os.path.join(dest_dir, os.path.basename(src))
    shutil.move(src, dest_path)
    return f"Moved {src} to {dest_path}"

"""
Lobster (OpenClaw) 本地及分布式客户端工具

支持多实例模式:
- LOCAL:  本地运行的 OpenClaw (127.0.0.1:18789)
- CLOUD:  云端运行的 OpenClaw (通过 URL 访问)

配置方案 (环境变量):
- OPENCLAW_NODES: JSON 字符串，例如 '[{"id": "local", "name": "本地节点", "url": "http://127.0.0.1:18789"}, {"id": "cloud", "name": "云端节点", "url": "https://api.cloud-claw.ai"}]'
"""

import os
import json
import subprocess
import requests
from typing import Dict, List, Optional, Any
from langchain.tools import tool
from utils.logger import setup_logger

logger = setup_logger("lobster_tools")

STORAGE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "storage", "lobster_nodes.json")

def get_nodes_config() -> List[Dict[str, Any]]:
    """获取所有配置好的节点 (优先从持久化文件读取)"""
    # 1. 尝试从文件读取
    if os.path.exists(STORAGE_FILE):
        try:
            with open(STORAGE_FILE, "r", encoding="utf-8") as f:
                nodes = json.load(f)
                return nodes
        except Exception as e:
            logger.error(f"Failed to read lobster_nodes.json: {e}")

    # 2. 如果文件不存在，尝试从环境变量读取 (兼容性)
    nodes_raw = os.environ.get("OPENCLAW_NODES")
    if nodes_raw:
        try:
            nodes = json.loads(nodes_raw)
            return nodes
        except Exception as e:
            logger.error(f"Failed to parse OPENCLAW_NODES: {e}")
    
    # 3. 默认回退 (包含拟人化信息和场景坐标)
    return [
        {
            "id": "local", 
            "name": "Local Specialist", 
            "role": "本地技术专家", 
            "avatar": "👨‍💻", 
            "personality": "高效、务实，擅长本地资源调度",
            "scene_pos": {"x": 20, "y": 60},
            "url": "http://127.0.0.1:18789", 
            "type": "local"
        },
        {
            "id": "cloud", 
            "name": "Cloud Architect", 
            "role": "云端架构师", 
            "avatar": "☁️", 
            "personality": "见多识广、深谋远虑，擅长处理复杂任务",
            "scene_pos": {"x": 70, "y": 30},
            "url": "https://api.cloud-claw.ai", 
            "type": "remote"
        }
    ]

def save_nodes_config(nodes: List[Dict[str, Any]]):
    """保存节点配置到持久化文件"""
    try:
        os.makedirs(os.path.dirname(STORAGE_FILE), exist_ok=True)
        with open(STORAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(nodes, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Failed to save lobster_nodes.json: {e}")
        return False

def scan_local_nodes() -> List[Dict[str, Any]]:
    """扫描本地常用端口，查找 OpenClaw 实例，并根据指纹去重"""
    discovered = []
    seen_fingerprints = set()
    
    # 扫描范围 18789 - 18800
    for port in range(18789, 18801):
        for host in ["localhost", "127.0.0.1"]:
            url = f"http://{host}:{port}"
            try:
                # 增加超时时间以确保响应稳定
                resp = requests.get(url, timeout=1.5)
                
                # 即使是 401 Unauthorized 或者 200 OK，只要在这个端口段有响应，大概率是目标
                if resp.status_code in [200, 401, 403]:
                    # 尝试获取指纹 (通过获取 models 列表或页面内容)
                    fingerprint = f"{port}" # 默认
                    try:
                        models_resp = requests.get(f"{url}/v1/models", timeout=0.5)
                        if models_resp.status_code == 200:
                            fingerprint = models_resp.text[:500] # 使用 models 响应的前 500 字符作为指纹
                        else:
                            fingerprint = resp.text[:500] # 退而求其次使用网页内容
                    except:
                        pass
                    
                    if fingerprint in seen_fingerprints:
                        continue
                    
                    # 进一步确认特征 (可选)
                    is_hit = False
                    if resp.status_code == 401 or "OpenClaw" in resp.text or "<openclaw-app>" in resp.text:
                        is_hit = True
                    
                    # 强力兜底：常见端口直接放行
                    if port in [18789, 18791, 18792]:
                        is_hit = True

                    if is_hit:
                        seen_fingerprints.add(fingerprint)
                        discovered.append({
                            "id": f"local_{port}",
                            "name": f"OpenClaw Node {port}",
                            "url": f"http://127.0.0.1:{port}",
                            "type": "local",
                            "role": "本地代理",
                            "avatar": "🦞",
                            "personality": "自动发现的本地节点",
                            "scene_pos": {"x": 50, "y": 50}
                        })
                        break # 找到一个 host 即可
            except:
                continue
    return discovered

OPENCLAW_TIMEOUT = int(os.environ.get("OPENCLAW_TIMEOUT", "120"))
OPENCLAW_API_TOKEN = os.environ.get("OPENCLAW_API_TOKEN", "")

# ------------------------------------------------------------------
# 底层通信方法
# ------------------------------------------------------------------

def _call_openclaw_rest(url: str, message: str) -> str:
    """通过 REST API 调用指定节点的 OpenClaw"""
    endpoint = f"{url.rstrip('/')}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if OPENCLAW_API_TOKEN:
        headers["Authorization"] = f"Bearer {OPENCLAW_API_TOKEN}"

    payload = {
        "model": "openclaw",
        "messages": [{"role": "user", "content": message}],
        "stream": False,
    }
    resp = requests.post(endpoint, json=payload, headers=headers, timeout=OPENCLAW_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices", [])
    if choices:
        return choices[0].get("message", {}).get("content", "")
    return data.get("response") or data.get("content") or ""

def _call_openclaw_cli(message: str) -> str:
    """通过本地 CLI 调用 OpenClaw"""
    result = subprocess.run(
        ["openclaw", "agent", "--agent", "main", "--message", message],
        capture_output=True,
        text=True,
        timeout=OPENCLAW_TIMEOUT,
    )
    if result.returncode == 0:
        return result.stdout.strip() or "✅ 任务已发送给本地 OpenClaw Agent"
    else:
        raise RuntimeError(f"openclaw CLI 错误: {result.stderr.strip()}")

# ------------------------------------------------------------------
# LangChain Tools
# ------------------------------------------------------------------

@tool
def check_openclaw_status() -> str:
    """
    🦞 检查所有配置好的 OpenClaw (龙虾) 节点状态。
    """
    nodes = get_nodes_config()
    results = []
    
    for node in nodes:
        node_id = node.get("id")
        url = node.get("url", "")
        name = node.get("name", node_id)
        
        status = {"name": name, "id": node_id, "url": url, "online": False, "methods": []}
        
        # 1. 检查 HTTP 是否可达
        try:
            resp = requests.get(url, timeout=5)
            if resp.status_code < 500:
                status["online"] = True
                status["methods"].append("Web UI")
        except:
            pass
            
        # 2. 检查 REST API
        try:
            test_resp = requests.post(
                f"{url.rstrip('/')}/v1/chat/completions",
                json={"model": "openclaw", "messages": [{"role": "user", "content": "ping"}]},
                timeout=3
            )
            if test_resp.status_code < 500:
                status["online"] = True
                status["methods"].append("REST API")
        except:
            pass
            
        # 3. 如果是本地节点，检查 CLI
        if node.get("type") == "local" or "127.0.0.1" in url or "localhost" in url:
            try:
                r = subprocess.run(["openclaw", "--version"], capture_output=True, timeout=2)
                if r.returncode == 0:
                    status["methods"].append("CLI")
            except:
                pass
        
        icon = "✅" if status["online"] else "❌"
        methods_str = ",".join(status["methods"]) if status["methods"] else "无可用通信方式"
        results.append(f"{icon} **{name}** ({node_id}): {methods_str}")
        
    return "🦞 **OpenClaw 节点状态报告:**\n\n" + "\n".join(results)

@tool
def coordinate_a2a_discussion(task: str) -> str:
    """
    🦞 向所有 OpenClaw (龙虾) 节点发起 A2A (Agent-to-Agent) 交互协同。
    
    在这种模式下，多个不同设备的 Agent 会共同完成一个任务：
    1. 广播初始任务。
    2. 收集各节点的第一轮见解。
    3. (可选/进阶) 节点间互相点评或汇总。
    """
    nodes = get_nodes_config()
    online_responses = []
    
    import concurrent.futures
    
    # 第一阶段：见解收集
    def _get_insight(node):
        node_id = node.get("id")
        name = node.get("name", node_id)
        url = node.get("url", "")
        try:
            res = _call_openclaw_rest(url, task)
            return {"id": node_id, "name": name, "reply": res, "success": True}
        except:
            if node.get("type") == "local" or "127.0.0.1" in url:
                try:
                    res = _call_openclaw_cli(task)
                    return {"id": node_id, "name": name, "reply": res, "success": True}
                except Exception as e:
                    return {"id": node_id, "name": name, "reply": f"错误: {e}", "success": False}
            return {"id": node_id, "name": name, "reply": "节点离线", "success": False}

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(nodes)) as executor:
        insights = list(executor.map(_get_insight, nodes))

    # 第二阶段：协作互动逻辑
    combined_context = "\n".join([f"[{r['name']}]: {r['reply']}" for r in insights if r['success']])
    
    final_orchestration = [
        "🏢 **OpenClaw 数字办公室 · 协作进行中**\n",
        "--- **NPC 见解录入** ---"
    ]
    for r in insights:
        # 查找该节点的 persona 信息
        node_meta = next((n for n in nodes if n['id'] == r['id']), {})
        avatar = node_meta.get("avatar", "🤖")
        role = node_meta.get("role", "员工")
        final_orchestration.append(f"{avatar} **{r['name']}** ({role}): {r['reply']}\n")
        
    final_orchestration.append("--- **协作结论 (Final Alignment)** ---")
    
    valid_insights = [r for r in insights if r.get('success')]
    if len(valid_insights) > 1:
        summary_prompt = (
            "你正在参与一场 OpenClaw NPC 员工群聊会议。\n"
            "以下是各部门（设备节点）的初步见解。请基于这些输入，给出一个统一的协作对齐方案。\n"
            "请注意：你的回复应该展现出 NPC 员工的拟人化特征，仿佛你们真的在办公室讨论。\n\n"
            f"会议摘要：\n{combined_context}"
        )
        try:
            primary_node = next(n for n in nodes if any(r['id'] == n['id'] and r.get('success') for r in insights))
            final_summary = _call_openclaw_rest(primary_node['url'], summary_prompt)
            final_orchestration.append(final_summary)
        except Exception as e:
            logger.error(f"A2A summary error: {e}")
            final_orchestration.append("协作完成，以上为各部门原始输出。")
    else:
        final_orchestration.append("当前仅有一个在线节点，已完成单机执行。")

    return "\n".join(final_orchestration)

@tool
def send_task_to_openclaw(task: str, node_id: str = "auto") -> str:
    """
    🦞 向指定的 OpenClaw (龙虾) 节点发送任务并获取执行结果。
    
    Args:
        task: 自然语言任务描述
        node_id: 目标节点 ID (如 'local', 'cloud', 或 'auto' 自动选择)
    """
    nodes = get_nodes_config()
    target_node = None
    
    if node_id == "auto":
        # 简单的自动选择策略：选择第一个在线且支持 REST 的节点
        for n in nodes:
            target_node = n
            break
    else:
        for n in nodes:
            if n.get("id") == node_id:
                target_node = n
                break
                
    if not target_node:
        return f"❌ 未找到 ID 为 {node_id} 的 OpenClaw 节点。"

    url = target_node.get("url", "")
    logger.info(f"Targeting OpenClaw Node: {target_node.get('name')} ({url})")

    # 优先尝试 REST API
    try:
        result = _call_openclaw_rest(url, task)
        return f"🦞 **OpenClaw ({target_node.get('name')}) 执行结果:**\n\n{result}"
    except Exception as e:
        logger.warning(f"REST call failed for {node_id}: {e}")
        
        # 如果是本地节点且 REST 失败，尝试 CLI
        if target_node.get("type") == "local" or "127.0.0.1" in url:
            try:
                result = _call_openclaw_cli(task)
                return f"🦞 **OpenClaw (本地 CLI) 执行结果:**\n\n{result}"
            except Exception as cli_e:
                return f"❌ 任务执行失败。REST 错误: {e}, CLI 错误: {cli_e}"
        
        return f"❌ 任务执行失败 ({node_id}): {str(e)}"

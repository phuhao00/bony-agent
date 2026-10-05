#!/usr/bin/env python3
"""OpenAI 兼容 LLM 桩服务（本地干跑专用）。

让 bony-agent 在【没有任何真实 LLM API Key】时也能跑通完整链路：
把所有 /v1/chat/completions 请求路由到确定性回复 ——
短视频文案请求返回固定旁白，检索词请求返回固定关键词列表。

仅用于 CI / 沙箱 / Agent 环境自测，不要用于生产。

用法:
    python3 scripts/arena/llm_stub.py [端口]      # 默认 8765
配合:
    LLM_PROVIDER=ollama  OLLAMA_BASE_URL=http://127.0.0.1:8765/v1
"""
from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

SCRIPT_TEXT = (
    "你敢信吗？只需要一句话，AI 就能帮你做出一条完整的短视频！"
    "今天这条视频，从文案、配音、画面到字幕，全部由 AI 自动完成。"
    "这就像拥有一支 24 小时不休息的内容团队，而你只需要提供一个想法。"
    "从热点追踪到多平台发布，整个流程全自动运转。"
    "一个人，也能做一支队伍的事！"
)

SEARCH_TERMS = (
    "artificial intelligence\n"
    "futuristic technology\n"
    "robot assistant\n"
    "digital workflow\n"
    "creative studio"
)


def make_reply(prompt: str) -> str:
    if "关键词" in prompt or "B-roll" in prompt or "素材" in prompt:
        return SEARCH_TERMS
    if "旁白" in prompt or "文案" in prompt:
        return SCRIPT_TEXT
    return "收到。这是本地桩模型的占位回复，仅用于链路连通性测试。"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _json(self, code: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # 健康检查/模型列表
        if self.path.rstrip("/").endswith("models"):
            self._json(200, {"object": "list", "data": [
                {"id": "arena-stub", "object": "model", "created": int(time.time()), "owned_by": "arena-stub"}
            ]})
        else:
            self._json(200, {"status": "ok", "stub": True})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"error": "bad request"}); return

        messages = body.get("messages", [])
        prompt = " ".join(str(m.get("content", "")) for m in messages)
        content = make_reply(prompt)
        self._json(200, {
            "id": "chatcmpl-arena-stub",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": body.get("model", "arena-stub"),
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        })


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.getenv("LLM_STUB_PORT", "8765"))
    print(f"[llm-stub] listening on 127.0.0.1:{port}", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()

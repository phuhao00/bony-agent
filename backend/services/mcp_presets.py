"""
Built-in MCP catalog: metadata for presets that support one‑click local launch
(Streamable HTTP) and registration in storage/mcp_servers.json.
"""

from __future__ import annotations

from typing import Any

_BASE = "https://github.com/modelcontextprotocol/servers/tree/main/src"

# Dedicated localhost ports per preset (avoid clashes with typical dev ports).
# 官方参考实现自 36835 起间隔 +2，与 duckduckgo/playwright 错开；动态分配时也会跳过同伴默认口。
MCP_PRESET_SPECS: dict[str, dict[str, Any]] = {
    "duckduckgo": {
        "default_port": 36831,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": "https://github.com/nickclyde/duckduckgo-mcp-server",
        "name_zh": "DuckDuckGo 搜索 MCP",
        "name_en": "DuckDuckGo Search MCP",
        "uvx_package": "duckduckgo-mcp-server",
        "cli_name": "duckduckgo-mcp-server",
        "description_zh": "DuckDuckGo 网页搜索与页面正文抓取（需本机 uv 或 pip 包）",
        "description_en": "DuckDuckGo web search and page fetching (needs uv or pip package)",
    },
    "playwright": {
        "default_port": 36833,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": "https://github.com/microsoft/playwright-mcp",
        "name_zh": "Playwright 浏览器 MCP",
        "name_en": "Playwright Browser MCP",
        "description_zh": "浏览器自动化快照与操作（需 Node.js 18+ 与本机 npx）",
        "description_en": "Browser automation snapshots (needs Node.js 18+ with npx)",
    },
    # —— MCP 官方参考服务器（src/*）———————————————————————————
    "official_everything": {
        "default_port": 36835,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/everything",
        "name_zh": "官方 Everything MCP",
        "name_en": "Official Everything MCP",
        "description_zh": "协议能力与特性演示（内置 Streamable HTTP，需 Node npx）。",
        "description_en": "Protocol feature reference server (built-in Streamable HTTP, needs Node/npx).",
        "launcher": {"kind": "everything_npx"},
    },
    "official_memory": {
        "default_port": 36837,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/memory",
        "name_zh": "官方 Memory MCP",
        "name_en": "Official Memory MCP",
        "description_zh": "图谱式记忆存储（stdio + supergateway→HTTP，需 Node npx）。",
        "description_en": "Knowledge-graph memory (stdio via supergateway, needs Node/npx).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {
                "executable": "npx",
                "args": ["-y", "@modelcontextprotocol/server-memory@latest"],
            },
        },
    },
    "official_filesystem": {
        "default_port": 36839,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/filesystem",
        "name_zh": "官方 Filesystem MCP",
        "name_en": "Official Filesystem MCP",
        "description_zh": "限定访问项目根目录下文件（stdio + supergateway，需 Node npx）。",
        "description_en": "Sandboxed filesystem under project root (stdio via supergateway, Node/npx).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {
                "executable": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem@latest", "{project_root}"],
            },
        },
    },
    "official_sequentialthinking": {
        "default_port": 36841,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/sequentialthinking",
        "name_zh": "官方 Sequential Thinking MCP",
        "name_en": "Official Sequential Thinking MCP",
        "description_zh": "分步推理工具（stdio + supergateway，需 Node npx）。",
        "description_en": "Step-by-step thinking tools (stdio via supergateway, Node/npx).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {
                "executable": "npx",
                "args": ["-y", "@modelcontextprotocol/server-sequential-thinking@latest"],
            },
        },
    },
    "official_fetch": {
        "default_port": 36843,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/fetch",
        "name_zh": "官方 Fetch MCP",
        "name_en": "Official Fetch MCP",
        "description_zh": "抓取网页转 Markdown（stdio + supergateway；推荐安装 uv 后使用 uvx）。",
        "description_en": "Fetch URLs to Markdown (stdio via supergateway; install via `pip install mcp-server-fetch` or uvx).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {"executable": "uvx", "args": ["mcp-server-fetch"]},
        },
    },
    "official_git": {
        "default_port": 36845,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/git",
        "name_zh": "官方 Git MCP",
        "name_en": "Official Git MCP",
        "description_zh": "仓库操作工具（绑定当前项目根目录，需 uvx 或 pip 安装 mcp-server-git）。",
        "description_en": "Git tools for the workspace repo root (needs uvx or pip package `mcp-server-git`).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {
                "executable": "uvx",
                "args": ["mcp-server-git", "--repository", "{project_root}"],
            },
        },
    },
    "official_time": {
        "default_port": 36847,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": f"{_BASE}/time",
        "name_zh": "官方 Time MCP",
        "name_en": "Official Time MCP",
        "description_zh": "时间与多时区工具（stdio + supergateway，需 uvx/pip）。",
        "description_en": "Time and timezone tools (stdio via supergateway; needs uvx or pip `mcp-server-time`).",
        "launcher": {
            "kind": "supergateway",
            "stdio": {"executable": "uvx", "args": ["mcp-server-time"]},
        },
    },
    "codegraph": {
        "default_port": 36849,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": "https://github.com/colbymchenry/codegraph",
        "name_zh": "CodeGraph 代码图谱 MCP",
        "name_en": "CodeGraph Code Intelligence MCP",
        "description_zh": "本地代码知识图谱：explore/search/callers/impact（优先使用仓库 vendor/codegraph；需 Node.js 18+；首次需 init 索引）。",
        "description_en": "Local code knowledge graph (prefers vendored vendor/codegraph; Node.js 18+; run init to index).",
        "launcher": {"kind": "codegraph_npx"},
    },
    "hermes_local": {
        "default_port": 36851,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": "https://github.com/NousResearch/hermes-agent",
        "name_zh": "Hermes Agent MCP",
        "name_en": "Hermes Agent MCP",
        "description_zh": "本地 Hermes Agent（hermes mcp serve）：会话检索、跨平台发消息等。需已安装 hermes CLI。",
        "description_en": "Local Hermes Agent via hermes mcp serve — session search, cross-platform messaging. Requires hermes CLI.",
        "launcher": {
            "kind": "supergateway",
            "stdio": {
                "executable": "hermes",
                "args": ["mcp", "serve", "--accept-hooks"],
            },
        },
    },
    "ai_media_agent": {
        "default_port": 36850,
        "http_url_host": "localhost",
        "http_path": "/mcp",
        "github": "https://github.com/NousResearch/hermes-agent",
        "name_zh": "AI Media Agent MCP（本机）",
        "name_en": "AI Media Agent MCP (local)",
        "description_zh": "暴露本平台媒体/知识库/发布工具，供 Hermes 或其他 MCP 客户端调用。需后端 media_mcp_server 进程。",
        "description_en": "Expose image/video/knowledge/publish tools for Hermes or other MCP clients. Requires media_mcp_server process.",
        "launcher": {
            "kind": "python_module",
            "module": "services.media_mcp_server",
        },
    },
}


def server_entry_id(preset_id: str) -> str:
    """Stable MCP server row id stored in mcp_servers.json."""
    return f"mcp-preset-{preset_id}"


def build_mcp_url(host: str, port: int, path: str) -> str:
    path = path if path.startswith("/") else f"/{path}"
    host = host or "127.0.0.1"
    return f"http://{host}:{port}{path}"


def preset_public_url(spec: dict[str, Any], port: int, bind_host: str = "127.0.0.1") -> str:
    """写入 mcp_servers.json 的 URL：Host 头须与 MCP 进程的访问控制一致。"""
    h = spec.get("http_url_host") or bind_host
    return build_mcp_url(str(h), port, str(spec.get("http_path", "/mcp")))

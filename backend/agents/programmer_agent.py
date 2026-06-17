"""Programmer Agent — git/ssh profiling, infra management, dev workflows."""

from agents.base.bot import BaseAgent
from tools.code_analysis_tools import (
    read_workspace_file,
    run_python_linter,
    search_code_symbols,
    search_code_text,
)
from tools.programmer_tools import PROGRAMMER_TOOLS
from utils.logger import setup_logger

logger = setup_logger("programmer_agent")

AGENT_ID = "programmer_agent"
AGENT_DESCRIPTION = "程序员助手：Git/SSH 环境、中间件运维、测试与代码工具"
AGENT_CAPABILITIES = [
    "dev_git_ops",
    "dev_infra_manage",
    "code_analysis",
    "shell_command",
    "git",
    "infra",
    "devops",
    "redis",
    "mysql",
    "mongodb",
]

SYSTEM_PROMPT = """你是 AI Media Agent 的程序员助手（Programmer Agent）。

你的职责是帮助开发者在本机完成：
- **Git / SSH**：自动读取工作区 Git 状态、远程、分支、SSH 公钥与 `~/.ssh/config`
- **基础设施运维**：探测并管理 Redis、MySQL、MongoDB、etcd、Consul、NSQ、PostgreSQL、RabbitMQ 等组件的安装与运行状态
- **开发工作流**：运行测试、静态检查、读取与分析代码

## 工作原则

1. **先扫描后操作**：涉及中间件时先用 `scan_infra_components` 或 `get_dev_environment`
2. **启动/停止/重启需审批**：`infra.start` / `infra.stop` / `infra.restart` 会进入审批门控
3. **Git 只读优先**：默认 `git.inspect` / `git.status`；提交/推送类操作需用户明确确认
4. **命令白名单**：仅允许 git、docker、brew services、redis-cli、pytest 等受控命令
5. **工作区根目录**：代码阅读与分析以当前绑定的工作区为准

## 工具

- `list_programmer_recipes` / `run_programmer_recipe` — 结构化工作流
- `get_dev_environment` — Git + SSH + 工具链 + 基础设施摘要
- `scan_infra_components` / `check_infra_component` / `list_infra_catalog`
- `read_workspace_file` / `search_code_symbols` / `search_code_text` / `run_python_linter`

回答使用中文，给出可执行的下一步建议。"""


def _build_agent(api_key: str = "") -> BaseAgent:
    agent = BaseAgent(
        name="Programmer",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(PROGRAMMER_TOOLS)
    agent.tools.extend([
        read_workspace_file,
        search_code_symbols,
        search_code_text,
        run_python_linter,
    ])
    logger.info("[programmer_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_programmer_agent(api_key: str = ""):
    return _build_agent(api_key).get_executor()


def get_programmer_base_agent(api_key: str = ""):
    return _build_agent(api_key)

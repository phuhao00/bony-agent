"""
Code Analyst Agent — 代码理解、符号搜索、调用图、审查与架构分析。
"""

from agents.base.bot import BaseAgent
from tools.code_analysis_tools import (
    get_code_call_graph,
    init_codegraph_index,
    read_workspace_file,
    run_python_linter,
    search_code_symbols,
    search_code_text,
)
from tools.skill_tools import skill_view, skills_list
from utils.logger import setup_logger

logger = setup_logger("code_analyst_agent")

AGENT_ID = "code_analyst_agent"
AGENT_DESCRIPTION = "代码分析专家：符号搜索、调用关系、源码阅读、审查与架构建议"
AGENT_CAPABILITIES = [
    "code_analysis",
    "code_review",
    "architecture",
    "symbol_search",
    "call_graph",
]

SYSTEM_PROMPT = """你是本项目的代码分析专家（Code Analyst Agent）。

你的职责是帮助开发者理解代码库、定位符号与调用关系、审查代码质量，并给出架构/目录规范建议。

## 工具使用顺序（渐进式取证，勿一次性猜测）

1. **有明确文件路径**（含用户 @ 附加的工作区文件）→ 先 `read_workspace_file`
2. **找符号 / 谁定义 / 在哪** → `search_code_symbols`
3. **调用链 / 依赖 / 谁在用** → `get_code_call_graph`（可先 search 定位 symbol）
4. **字符串/模式搜索**（CodeGraph 补盲）→ `search_code_text`
5. **代码审查任务** → 先 `skill_view('code-reviewer')` 加载审查清单，再结合读文件与调用图输出
6. **架构/目录规范** → 先 `skill_view('project-architect')`，再结合仓库结构给建议
7. **Python 静态检查**（可选）→ `run_python_linter`
8. **索引未就绪** → `init_codegraph_index` 或提示用户在 设置 → CodeGraph 初始化

## 输出格式

- **摘要**：一两句话结论
- **依据**：引用具体 `path:line` 或符号名
- **发现**：分 Critical / Major / Minor（审查类）或分点说明（理解类）
- **建议**：可执行的下一步（含重构/移动文件建议时说明理由）

## 约束

- 不要编造未读过的代码；工具失败时如实说明
- 大文件分段 `read_workspace_file`，不要假设全文
- 区分「内容审核 reviewer_agent」与「代码审查」— 你只做代码/架构分析
- 用户附加的工作区文件路径会在消息中标注，优先分析这些文件
- 消息中含「工作区根目录」时，表示用户已绑定本地仓库；即使未 @ 具体文件，也必须先用工具探索（README、目录结构、入口文件、与用户问题相关的符号），禁止回复「请提供文件路径」
- 泛化请求如「分析代码」「看看项目」：先 `search_code_text` 或读 `README.md` / `AGENTS.md`，再给出结构化结论
"""


def _build_agent() -> BaseAgent:
    logger.debug("[code_analyst_agent] _build_agent() called")
    agent = BaseAgent(
        name="CodeAnalyst",
        system_prompt=SYSTEM_PROMPT,
        agent_id=AGENT_ID,
        description=AGENT_DESCRIPTION,
        capabilities=AGENT_CAPABILITIES,
        with_memory=False,
        with_rag=False,
    )
    agent.tools.extend(
        [
            search_code_symbols,
            get_code_call_graph,
            read_workspace_file,
            search_code_text,
            init_codegraph_index,
            run_python_linter,
            skills_list,
            skill_view,
        ]
    )
    logger.info("[code_analyst_agent] built agent_id=%s tools=%d", AGENT_ID, len(agent.tools))
    return agent


def get_code_analyst_agent(api_key: str):
    logger.info("[code_analyst_agent] get_code_analyst_agent() → executor")
    return _build_agent().get_executor(api_key)


def get_code_analyst_base_agent(api_key: str = "") -> BaseAgent:
    logger.debug("[code_analyst_agent] get_code_analyst_base_agent() called")
    return _build_agent()

# Project Context for GitHub Copilot

This project is a **全链路内容生产与分发数字员工** (Full-chain Content Production & Distribution Digital Employee) AI Agent system.
It replaces manual work from content creation, video production to multi-platform publishing.

Built with Python, LangChain/LangGraph, Next.js, and Streamlit.
Uses ZhipuAI (GLM-4-Plus, CogView-3-Plus, CogVideoX) for LLM and media generation.

## Product Positioning

- **Core Value**: 80% efficiency improvement, cost optimization, compliance assurance, matrix collaboration
- **Target Users**: Content creators, MCN agencies, brand marketing teams

## Project Structure

- `agent/bot.py`: Standard Tool Agent using LangChain.
- `agent/planning_bot.py`: Planning Agent using LangGraph (Plan-and-Execute pattern).
- `server.py`: FastAPI + LangServe backend API.
- `web/`: Next.js frontend with Vercel AI SDK.
- `tools/`: Tool definitions.
  - `media_tools.py`: `generate_image`, `generate_video` using ZhipuAI.
  - `memory_tools.py`: `search_memory`, `save_generation_to_memory` using ChromaDB.
  - `rag_tools.py`: `search_knowledge_base` using RAG.
- `utils/`: Helper functions.
- `pages/`: Streamlit pages.
- `app.py`: Streamlit entry point.

## Key Libraries

- LangChain (`langchain`, `langchain_openai`, `langchain_core`)
- LangGraph (`langgraph`)
- LangServe (`langserve`)
- ZhipuAI (`zhipuai`)
- Streamlit (`streamlit`)
- Next.js + Vercel AI SDK
- ChromaDB (`chromadb`)

## Coding Conventions

- Use `utils.logger` for logging.
- Tools should be decorated with `@tool` from `langchain.tools`.
- Use Python type hints.
- Docstrings can be in Chinese or English.

## Available Skills & Agents

### Content Generation Skills

- **Script Writer**: `.agent/skills/script-writer/SKILL.md` (视频脚本生成)
- **Copywriting**: `.agent/skills/copywriting/SKILL.md` (软文/标题/平台文案生成)
- **Media Production**: `.agent/skills/media/SKILL.md` (图片/视频/图生视频生成)

### Video Production Skills

- **Video Editor**: `.agent/skills/video-editor/SKILL.md` (AI视频混剪)

### Publishing & Operations Skills

- **Platform Publisher**: `.agent/skills/platform-publisher/SKILL.md` (多平台发布)
- **Moderation**: `.agent/skills/moderation/SKILL.md` (内容安全审核)
- **Env Manager**: `.agent/skills/env-manager/SKILL.md` (环境与依赖管理)

### Development Skills

- **Code Reviewer**: `.agent/skills/code-reviewer/SKILL.md`
- **Test Generator**: `.agent/skills/test-generator/SKILL.md`
- **Doc Writer**: `.agent/skills/doc-writer/SKILL.md`
- **RAG Expert**: `.agent/skills/rag-expert/SKILL.md`
- **Project Requirements**: `.agent/skills/project-requirements/SKILL.md`
- **Product Designer**: `.agent/skills/product-designer/SKILL.md`

### Design & Visual Skills

- **Frontend Design**: `.agent/skills/frontend-design/SKILL.md` (前端UI组件/页面/Dashboard/落地页生成，避免"AI味"，生成高质量产品级界面)
- **Canvas Design**: `.agent/skills/canvas-design/SKILL.md` (Canvas图形设计，海报/封面/社交媒体配图)
- **Algorithmic Art**: `.agent/skills/algorithmic-art/SKILL.md` (算法艺术/生成式图形/程序化视觉)
- **Theme Factory**: `.agent/skills/theme-factory/SKILL.md` (主题/配色方案/设计Token生成)
- **Brand Guidelines**: `.agent/skills/brand-guidelines/SKILL.md` (品牌规范文档，Logo使用/颜色/字体/视觉语言)

### Office Document Skills

- **DOCX**: `.agent/skills/docx/SKILL.md` (生成Word文档，合同/报告/方案/规范)
- **XLSX**: `.agent/skills/xlsx/SKILL.md` (生成Excel表格，数据报表/统计/财务表格)
- **PPTX**: `.agent/skills/pptx/SKILL.md` (生成PowerPoint演示文稿，PPT/汇报/提案)
- **PDF**: `.agent/skills/pdf/SKILL.md` (PDF生成与表单处理)

### Developer Tools Skills

- **MCP Builder**: `.agent/skills/mcp-builder/SKILL.md` (构建MCP服务器，集成外部API/服务到LLM工具链)
- **Claude API**: `.agent/skills/claude-api/SKILL.md` (Claude API多语言集成示例，Python/TypeScript/Go/Java/PHP/Ruby)
- **Web Artifacts Builder**: `.agent/skills/web-artifacts-builder/SKILL.md` (构建独立可运行的Web组件/应用)
- **Webapp Testing**: `.agent/skills/webapp-testing/SKILL.md` (Web应用自动化测试，E2E/UI测试)

### Communication & Workflow Skills

- **Internal Comms**: `.agent/skills/internal-comms/SKILL.md` (内部沟通文案，邮件/公告/通知/周报)
- **Doc Co-authoring**: `.agent/skills/doc-coauthoring/SKILL.md` (协作文档撰写，结构化长文档)
- **Slack GIF Creator**: `.agent/skills/slack-gif-creator/SKILL.md` (创建Slack GIF动画表情)
- **Skill Creator**: `.agent/skills/skill-creator/SKILL.md` (创建/评估/迭代新Skill，含benchmark流程)

See `.github/agents/AGENTS.md` for complete architecture and workflow details.

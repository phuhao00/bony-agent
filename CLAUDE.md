# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Media Agent is a full-chain AI-driven content production and distribution platform. It automates content creation from copywriting to AI image/video generation to multi-platform publishing (小红书, 抖音, B站, YouTube, Twitter, etc.).

**Architecture**: FastAPI backend + Next.js 16 frontend, LangGraph multi-Agent orchestration, Playwright for browser automation.

## Development Commands

### Start Development Environment

```bash
# Start both backend and frontend (recommended)
./start_local.sh

# Backend runs at http://localhost:8000
# Frontend runs at http://localhost:3000
# API docs at http://localhost:8000/docs
```

### Backend (Python/FastAPI)

```bash
cd backend

# Run with auto-reload
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Run tests
python -m pytest ../tests/<test_file>.py

# Install new package (use venv at project root)
pip install <package>
```

### Frontend (Next.js 16)

```bash
cd web

# Dev server
npm run dev

# Build
npm run build

# Lint
npm run lint
```

## Critical Project Rules

### 1. Virtual Environment (STRICT)

- **ONLY** use the `venv/` directory at project root
- **NEVER** run `rm -rf venv/` or `mv venv/`
- **NEVER** recreate the virtual environment
- **ALWAYS** incrementally install missing packages with `pip install <package>`
- If `backend/.venv` exists, use that instead (check `start_local.sh` logic)

### 2. Temporary Files (STRICT)

- **NEVER** use `/tmp` or system temp directories
- **ALWAYS** use `storage/temp/` for temporary files
- Example: `PROJECT_ROOT / "storage" / "temp"`

### 3. Storage Directory Structure

All persistent data goes under `storage/`:
- `storage/outputs/` - Generated media (images, videos)
- `storage/uploads/` - User uploaded files
- `storage/temp/` - Temporary files (not /tmp)
- `storage/rag/` - RAG vector indices
- `storage/memory/` - Agent memory storage
- `storage/scheduler/` - Scheduled job configs and logs

## Project Architecture

### Backend Structure (`backend/`)

```
backend/
├── main.py                 # FastAPI entry point, all API routes
├── agents/                 # LangGraph Agent definitions
│   ├── bot.py             # Standard ReAct Agent
│   ├── planning_bot.py    # Plan-and-Execute Agent
│   ├── reviewer_bot.py    # Content review Agent
│   └── video_editor_agent.py
├── core/                   # LLM provider configuration
│   └── llm_provider.py    # Multi-provider routing (Zhipu, Gemini, DeepSeek, etc.)
├── tools/                  # Atomic tool functions
│   ├── image_tools.py     # AI image generation
│   ├── video_tools.py     # AI video generation
│   ├── audio_tools.py     # TTS/voiceover
│   ├── copywriting_tools.py
│   ├── publisher_tools.py # Platform publishing
│   ├── trend_tools.py     # Trending analysis
│   ├── gaming_trending.py # Steam/Epic/TapTap scraping
│   ├── connectors/        # Social platform connectors
│   │   ├── xiaohongshu.py
│   │   ├── douyin.py
│   │   ├── bilibili.py
│   │   └── youtube.py
│   └── ...
├── services/
│   └── scheduler.py       # APScheduler for timed publishing
└── utils/
    ├── logger.py          # Unified logging (use this!)
    ├── rag_manager.py     # RAG knowledge base
    └── generation_history.py
```

### Frontend Structure (`web/`)

UI shell uses CSS variables in `app/globals.css` (`html.theme-dark` / `html.theme-light`): prefer `card-surface`, `page-canvas`, and `var(--foreground)` over hardcoded grays for contrast in both themes. See `docs/ARCHITECTURE_OVERVIEW.md` §4.5. Capabilities, approvals, tasks, and platform/local execution model: §4.6.

```
web/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Main AI chat interface (Markdown via MarkdownSummaryPreview)
│   ├── scheduler/         # Scheduled publishing management
│   ├── trending/          # Gaming trends dashboard
│   ├── create/            # Content creation (scripts/copywriting)
│   ├── media/             # Image/video generation
│   ├── platforms/         # Platform connection management
│   ├── knowledge/         # RAG knowledge base
│   ├── settings/context/  # My context: knowledge graph + Memory UI
│   └── api/               # API routes (proxies to backend)
├── components/            # React components (incl. MarkdownSummaryPreview.tsx)
└── contexts/             # React Context (e.g. Auth stub)
```

### Agent Skills (`.agent/skills/`)

Skill definitions for specialized agents:
- `copywriter/` - Copywriting generation
- `script-writer/` - Script writing
- `media-expert/` - Image/video generation
- `video-editor/` - Video editing
- `platform-publisher/` - Multi-platform publishing
- `content-moderator/` - Content safety review
- `rag-expert/` - Knowledge base management

## Environment Variables

Key variables in `backend/.env`:

```bash
# LLM Providers (at least one required)
ZHIPUAI_API_KEY=          # 智谱 GLM-4 / CogView / CogVideoX
OPENROUTER_API_KEY=       # Access to 100+ models
GOOGLE_API_KEY=           # Gemini
DEEPSEEK_API_KEY=
BYTEDANCE_API_KEY=        # 豆包
ALIBABA_API_KEY=          # 通义

# Media Generation
JIMENG_ACCESS_KEY=        # 即梦 AI
JIMENG_SECRET_KEY=
ARK_API_KEY=              # 豆包 SeaDance video

# Playwright
PLAYWRIGHT_BROWSERS_PATH=./.browsers
```

## Key API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /tools/script` | Generate video script |
| `POST /tools/copywriting` | Generate copywriting |
| `POST /tools/image` | Generate image |
| `POST /tools/video` | Generate video |
| `POST /tools/publish` | Publish to platform |
| `POST /tools/publish/all` | Publish to all platforms |
| `GET /scheduler/jobs` | List scheduled jobs |
| `POST /scheduler/jobs` | Create scheduled job |
| `POST /knowledge/upload` | Upload RAG document |
| `POST /knowledge/query` | Query knowledge base |

## Code Conventions

### Python
- Use 4-space indentation
- Use type hints
- Use `utils.logger.setup_logger()` for logging
- Decorate tools with `@tool` from `langchain.tools`

### TypeScript/React
- ESLint + Prettier configured
- Use Tailwind CSS for styling
- Components in PascalCase

## Testing

```bash
# Run specific test
cd backend
python -m pytest ../tests/test_script_rag.py

# Run with venv Python
./venv/bin/python -m pytest tests/test_lobster.py
```

## Troubleshooting

### Port already in use
```bash
lsof -ti:8000,3000 | xargs kill -9
```

### Playwright browser issues
```bash
python -m playwright install chromium
```

### Check logs
```bash
tail -f logs/agent.log
tail -f backend/agent.log
```

## Related Documentation

- `README.md` - Main project documentation
- `AGENTS.md` - Detailed Agent collaboration guide
- `docs/CANVAS_OVERVIEW.md` - Cursor Canvas workspace overview (charts, sync paths)
- `.agent/spec.md` - Agent behavior specification
- `docs/WINDOWS_DEPLOYMENT.md` - Windows deployment
- `docs/OAUTH_IMPLEMENTATION_GUIDE.md` - OAuth setup

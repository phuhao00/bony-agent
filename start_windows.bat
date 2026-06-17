@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title AI Media Agent - Windows 一键部署

:: ── 开启 VT100/ANSI 支持 (Windows 10+) ──────────────────────────────────
reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f >nul 2>&1

:: ── ANSI 颜色码 ────────────────────────────────────────────────────────────
for /f "delims=" %%E in ('echo prompt $E^| cmd /q') do set "ESC=%%E"
set "GREEN=!ESC![32m"
set "YELLOW=!ESC![33m"
set "RED=!ESC![31m"
set "CYAN=!ESC![36m"
set "BOLD=!ESC![1m"
set "NC=!ESC![0m"

:: ── 路径配置 ──────────────────────────────────────────────────────────────
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
cd /d "%ROOT_DIR%"

set "BACKEND_DIR=%ROOT_DIR%\backend"
set "WEB_DIR=%ROOT_DIR%\web"
set "LOGS_DIR=%ROOT_DIR%\logs"
set "TOOLS_DIR=%ROOT_DIR%\storage\tools"
set "VENV_DIR=%BACKEND_DIR%\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=3000"

set "PIP_MIRROR=-i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com"

if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"
if not exist "%ROOT_DIR%\storage" mkdir "%ROOT_DIR%\storage"
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"

echo.
echo %GREEN%╔══════════════════════════════════════════════════════════════════╗%NC%
echo %GREEN%║      🚀  AI Media Agent — Windows 一键部署脚本 v2              ║%NC%
echo %GREEN%╚══════════════════════════════════════════════════════════════════╝%NC%
echo.

:: ════════════════════════════════════════════════════════════════════════════
:: 检查管理员权限（自动安装依赖需要）
:: ════════════════════════════════════════════════════════════════════════════
net session >nul 2>&1
if !errorlevel! neq 0 (
    echo %YELLOW%[!]%NC% 当前未以管理员身份运行，正在请求提权...
    powershell -Command "Start-Process '%~f0' -Verb RunAs" 2>nul
    if !errorlevel! equ 0 ( exit /b 0 )
    echo %YELLOW%[!]%NC% 提权失败，以普通权限继续（部分安装可能受限）
)

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 1 · 停止已有服务%NC%
:: ════════════════════════════════════════════════════════════════════════════
taskkill /f /im node.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%BACKEND_PORT% " 2^>nul') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo %GREEN%[✓]%NC% 旧进程已清理
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 2 · 检测并安装 Python 3.10+%NC%
:: ════════════════════════════════════════════════════════════════════════════
call :REFRESH_PATH
call :CHECK_PYTHON
if "!PY_CMD!"=="" (
    call :INSTALL_PYTHON
    call :REFRESH_PATH
    call :CHECK_PYTHON
)
if "!PY_CMD!"=="" (
    echo %RED%[✗]%NC% Python 安装后仍无法检测到，请手动重启脚本
    pause & exit /b 1
)
for /f "tokens=2" %%v in ('!PY_CMD! --version 2^>^&1') do set "PY_VER=%%v"
for /f "tokens=1,2 delims=." %%a in ("!PY_VER!") do set "PY_MAJOR=%%a" & set "PY_MINOR=%%b"
if !PY_MAJOR! LSS 3 goto :PY_UPGRADE
if !PY_MAJOR! EQU 3 if !PY_MINOR! LSS 10 goto :PY_UPGRADE
echo %GREEN%[✓]%NC% Python !PY_VER! 就绪
goto :PY_DONE
:PY_UPGRADE
echo %YELLOW%[!]%NC% Python !PY_VER! 过低，需要 3.10+，正在升级...
call :INSTALL_PYTHON
call :REFRESH_PATH
call :CHECK_PYTHON
:PY_DONE
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 3 · 检测并安装 Node.js 18+%NC%
:: ════════════════════════════════════════════════════════════════════════════
call :CHECK_NODE
if "!NODE_OK!"=="" (
    call :INSTALL_NODE
    call :REFRESH_PATH
    call :CHECK_NODE
)
if "!NODE_OK!"=="" (
    echo %RED%[✗]%NC% Node.js 安装后仍无法检测到，请手动重启脚本
    pause & exit /b 1
)
for /f %%v in ('node --version') do set "NODE_VER=%%v"
echo %GREEN%[✓]%NC% Node.js !NODE_VER! 就绪
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 4 · 检测并安装 FFmpeg (视频混剪必需)%NC%
:: ════════════════════════════════════════════════════════════════════════════
call :CHECK_FFMPEG
if "!FFMPEG_OK!"=="" (
    call :INSTALL_FFMPEG
    call :REFRESH_PATH
    call :CHECK_FFMPEG
)
if "!FFMPEG_OK!"=="" (
    echo %YELLOW%[!]%NC% FFmpeg 未检测到，视频功能可能受限（其余功能正常）
) else (
    echo %GREEN%[✓]%NC% FFmpeg 就绪
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 5 · 检测并安装 Git%NC%
:: ════════════════════════════════════════════════════════════════════════════
where git >nul 2>&1
if !errorlevel! neq 0 (
    echo %YELLOW%[!]%NC% 未找到 Git，正在尝试安装...
    winget install --id Git.Git --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
    call :REFRESH_PATH
    where git >nul 2>&1 && echo %GREEN%[✓]%NC% Git 安装完成 || echo %YELLOW%[!]%NC% Git 安装失败（非必须）
) else (
    for /f "tokens=1-3" %%a in ('git --version') do echo %GREEN%[✓]%NC% git %%c 就绪
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 6 · 更新系统 PATH 环境变量%NC%
:: ════════════════════════════════════════════════════════════════════════════
call :ENSURE_IN_PATH "%TOOLS_DIR%\ffmpeg\bin"
call :ENSURE_IN_PATH "%APPDATA%\npm"
call :ENSURE_IN_PATH "%LOCALAPPDATA%\Programs\Python\Python312"
call :ENSURE_IN_PATH "%LOCALAPPDATA%\Programs\Python\Python312\Scripts"
call :ENSURE_IN_PATH "%LOCALAPPDATA%\Programs\Python\Python311"
call :ENSURE_IN_PATH "%LOCALAPPDATA%\Programs\Python\Python310"
echo %GREEN%[✓]%NC% PATH 环境变量已更新
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 7 · 创建存储目录%NC%
:: ════════════════════════════════════════════════════════════════════════════
for %%d in (
    "%ROOT_DIR%\storage\outputs"
    "%ROOT_DIR%\storage\uploads"
    "%ROOT_DIR%\storage\temp"
    "%ROOT_DIR%\storage\tmp"
    "%ROOT_DIR%\storage\rag"
    "%ROOT_DIR%\storage\memory"
    "%ROOT_DIR%\storage\knowledge"
    "%ROOT_DIR%\storage\profiles"
    "%ROOT_DIR%\storage\scheduler"
    "%ROOT_DIR%\storage\debug"
    "%ROOT_DIR%\storage\trending"
    "%ROOT_DIR%\storage\chroma_db"
    "%ROOT_DIR%\storage\tools"
    "%ROOT_DIR%\.browsers"
    "%ROOT_DIR%\logs"
) do ( if not exist %%d mkdir %%d )
echo %GREEN%[✓]%NC% 目录创建完成
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 8 · 配置 .env 环境变量文件%NC%
:: ════════════════════════════════════════════════════════════════════════════
set "ENV_FILE=%BACKEND_DIR%\.env"
if not exist "%ENV_FILE%" (
    if exist "%BACKEND_DIR%\.env.example" (
        copy "%BACKEND_DIR%\.env.example" "%ENV_FILE%" >nul
        echo %YELLOW%[!]%NC% 已从 .env.example 创建 backend\.env
    ) else (
        (
            echo # AI Media Agent 环境变量配置
            echo # 至少填写一个 LLM 供应商的 API Key
            echo.
            echo # ── LLM 配置（默认：通义千问 Qwen） ──
            echo LLM_PROVIDER=alibaba
            echo LLM_MODEL=qwen-max
            echo.
            echo # ── API Keys ──────────────────────
            echo ALIBABA_API_KEY=
            echo DASHSCOPE_API_KEY=
            echo ZHIPUAI_API_KEY=
            echo GOOGLE_API_KEY=
            echo DEEPSEEK_API_KEY=
            echo OPENAI_API_KEY=
            echo OPENROUTER_API_KEY=
            echo BYTEDANCE_API_KEY=
            echo ALIBABA_API_KEY=
            echo.
            echo # ── 即梦 AI 媒体生成 ──────────────
            echo JIMENG_ACCESS_KEY=
            echo JIMENG_SECRET_KEY=
            echo.
            echo # ── 服务配置 ──────────────────────
            echo BACKEND_HOST=127.0.0.1
            echo BACKEND_PORT=8000
        ) > "%ENV_FILE%"
    )
    echo %YELLOW%[!]%NC% 请在 backend\.env 中填入至少一个 API Key
    echo.
    echo 是否现在用记事本打开 .env 填写？(Y/N^)
    set /p "OPEN_ENV=请输入: "
    if /i "!OPEN_ENV!"=="Y" (
        notepad "%ENV_FILE%"
        echo %GREEN%[✓]%NC% .env 已保存，继续部署...
    )
) else (
    :: 检查是否已填写任意 API Key
    set "HAS_KEY=0"
    for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        set "_K=%%a" & set "_V=%%b"
        if /i "!_K!"=="ZHIPUAI_API_KEY"   if not "!_V!"=="" if not "!_V!"=="your_api_key_here" set "HAS_KEY=1"
        if /i "!_K!"=="GOOGLE_API_KEY"    if not "!_V!"=="" set "HAS_KEY=1"
        if /i "!_K!"=="DEEPSEEK_API_KEY"  if not "!_V!"=="" set "HAS_KEY=1"
        if /i "!_K!"=="OPENAI_API_KEY"    if not "!_V!"=="" set "HAS_KEY=1"
        if /i "!_K!"=="OPENROUTER_API_KEY" if not "!_V!"=="" set "HAS_KEY=1"
    )
    if "!HAS_KEY!"=="0" (
        echo %YELLOW%[!]%NC% backend\.env 存在但未检测到有效 API Key
        echo     路径: %ENV_FILE%
        echo.
        echo 是否现在用记事本打开填写？(Y/N^)
        set /p "OPEN_ENV2=请输入: "
        if /i "!OPEN_ENV2!"=="Y" notepad "%ENV_FILE%"
    ) else (
        echo %GREEN%[✓]%NC% backend\.env 已配置 API Key
    )
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 9 · 配置 Python 虚拟环境%NC%
:: ════════════════════════════════════════════════════════════════════════════
if not exist "%VENV_PY%" (
    echo 正在创建虚拟环境 backend\.venv ...
    if exist "%VENV_DIR%" rd /s /q "%VENV_DIR%"
    !PY_CMD! -m venv "%VENV_DIR%"
    if !errorlevel! neq 0 (
        echo %RED%[✗]%NC% 虚拟环境创建失败
        pause & exit /b 1
    )
    echo %GREEN%[✓]%NC% 虚拟环境创建完成
) else (
    echo %GREEN%[✓]%NC% 复用已有虚拟环境 backend\.venv
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 10 · 安装 Python 依赖 (首次约需 3-10 分钟)%NC%
:: ════════════════════════════════════════════════════════════════════════════
echo 升级 pip...
"%VENV_PY%" -m pip install --upgrade pip setuptools wheel -q %PIP_MIRROR%

echo 安装 requirements.txt 依赖...
"%VENV_PIP%" install -r "%BACKEND_DIR%\requirements.txt" %PIP_MIRROR% --timeout 120 --retries 3
if !errorlevel! neq 0 (
    echo %YELLOW%[!]%NC% 镜像安装失败，切换到官方源重试...
    "%VENV_PIP%" install -r "%BACKEND_DIR%\requirements.txt" --timeout 120 --retries 3
    if !errorlevel! neq 0 (
        echo %RED%[✗]%NC% Python 依赖安装失败，请检查网络连接
        pause & exit /b 1
    )
)

echo 安装补充依赖 (openai, httpx, anyio)...
"%VENV_PIP%" install openai httpx anyio llama-index-embeddings-langchain %PIP_MIRROR% --timeout 120 -q

echo %GREEN%[✓]%NC% Python 依赖安装完成
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 11 · 安装 Playwright Chromium (社媒自动发布必需)%NC%
:: ════════════════════════════════════════════════════════════════════════════
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT_DIR%\.browsers"
set "CHROMIUM_FOUND=0"
if exist "%ROOT_DIR%\.browsers\" (
    for /d %%d in ("%ROOT_DIR%\.browsers\chromium-*") do set "CHROMIUM_FOUND=1"
)
if "!CHROMIUM_FOUND!"=="0" (
    "%VENV_PY%" -m playwright install chromium
    if !errorlevel! neq 0 (
        echo %YELLOW%[!]%NC% Playwright 安装失败，社媒自动发布不可用，其余功能不受影响
    ) else (
        echo %GREEN%[✓]%NC% Playwright Chromium 安装完成
    )
) else (
    echo %GREEN%[✓]%NC% Playwright Chromium 已安装，跳过
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 12 · 安装前端依赖%NC%
:: ════════════════════════════════════════════════════════════════════════════
cd /d "%WEB_DIR%"
call npm install --legacy-peer-deps
if !errorlevel! neq 0 (
    echo %RED%[✗]%NC% 前端依赖安装失败
    pause & exit /b 1
)
echo %GREEN%[✓]%NC% 前端依赖安装完成
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 13 · 构建 Next.js (首次约需 2-5 分钟)%NC%
:: ════════════════════════════════════════════════════════════════════════════
set "NEXT_TELEMETRY_DISABLED=1"
call npm run build
if !errorlevel! neq 0 (
    echo %RED%[✗]%NC% 前端构建失败，请查看上方错误信息
    pause & exit /b 1
)
echo %GREEN%[✓]%NC% 前端构建完成
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 14 · 启动后端服务%NC%
:: ════════════════════════════════════════════════════════════════════════════
start "AI-Backend" cmd /k "title AI-Backend && cd /d "%BACKEND_DIR%" && set PYTHONPATH=%BACKEND_DIR% && set PLAYWRIGHT_BROWSERS_PATH=%ROOT_DIR%\.browsers && "%VENV_PY%" -m uvicorn main:app --host 127.0.0.1 --port %BACKEND_PORT% --log-level info"

echo %GREEN%[✓]%NC% 后端启动中 (端口 %BACKEND_PORT%)，等待就绪...
set "BACKEND_READY=0"
for /l %%i in (1,1,30) do (
    if "!BACKEND_READY!"=="0" (
        curl -sf http://127.0.0.1:%BACKEND_PORT%/health >nul 2>&1
        if !errorlevel! equ 0 (
            set "BACKEND_READY=1"
            echo %GREEN%[✓]%NC% 后端健康检查通过 ✓
        ) else (
            timeout /t 2 /nobreak >nul
        )
    )
)
if "!BACKEND_READY!"=="0" (
    echo %YELLOW%[!]%NC% 后端未在 60s 内响应，请检查 AI-Backend 窗口是否有报错
)
echo.

:: ════════════════════════════════════════════════════════════════════════════
echo %CYAN%%BOLD%▶ Step 15 · 启动前端服务%NC%
:: ════════════════════════════════════════════════════════════════════════════
start "AI-Frontend" cmd /k "title AI-Frontend && cd /d "%WEB_DIR%" && set NEXT_TELEMETRY_DISABLED=1 && node_modules\.bin\next start --hostname 127.0.0.1 --port %FRONTEND_PORT%"
timeout /t 5 /nobreak >nul
start http://127.0.0.1:%FRONTEND_PORT%

echo.
echo %GREEN%╔══════════════════════════════════════════════════════════════════╗%NC%
echo %GREEN%║       🚀  AI Media Agent — 已启动 (Windows)                    ║%NC%
echo %GREEN%╠══════════════════════════════════════════════════════════════════╣%NC%
echo %GREEN%║%NC%  🌐 前端界面    %CYAN%http://127.0.0.1:%FRONTEND_PORT%%NC%
echo %GREEN%║%NC%  ⚙️  后端 API    %CYAN%http://127.0.0.1:%BACKEND_PORT%%NC%
echo %GREEN%║%NC%  📖 接口文档    %CYAN%http://127.0.0.1:%BACKEND_PORT%/docs%NC%
echo %GREEN%╠══════════════════════════════════════════════════════════════════╣%NC%
echo %GREEN%║%NC%  🛑 停止服务: 运行 windows\stop.bat 或关闭以上两个窗口
echo %GREEN%╚══════════════════════════════════════════════════════════════════╝%NC%
echo.
pause
endlocal
goto :EOF

:: ════════════════════════════════════════════════════════════════════════════
:: ── 子函数区 ─────────────────────────────────────────────────────────────
:: ════════════════════════════════════════════════════════════════════════════

:: ── 刷新 PATH（读取注册表最新值）────────────────────────────────────────
:REFRESH_PATH
for /f "skip=2 tokens=3*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%a %%b"
for /f "skip=2 tokens=3*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%a %%b"
if defined SYS_PATH set "PATH=!SYS_PATH!"
if defined USER_PATH set "PATH=!PATH!;!USER_PATH!"
goto :EOF

:: ── 检测 Python ───────────────────────────────────────────────────────────
:CHECK_PYTHON
set "PY_CMD="
where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD where python3 >nul 2>&1 && set "PY_CMD=python3"
if not defined PY_CMD (
    for %%p in (
        "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
        "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
        "C:\Python312\python.exe"
        "C:\Python311\python.exe"
        "C:\Python310\python.exe"
    ) do ( if not defined PY_CMD if exist %%p set "PY_CMD=%%~p" )
)
goto :EOF

:: ── 安装 Python ───────────────────────────────────────────────────────────
:INSTALL_PYTHON
echo %YELLOW%[→]%NC% 正在安装 Python 3.12（通过 winget）...
winget install --id Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
if !errorlevel! equ 0 ( echo %GREEN%[✓]%NC% Python 3.12 安装完成 & goto :EOF )
echo %YELLOW%[!]%NC% winget 不可用，尝试下载安装包...
set "PY_INST=%TOOLS_DIR%\python-3.12-installer.exe"
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe' -OutFile '%PY_INST%' -UseBasicParsing" 2>nul
if exist "%PY_INST%" (
    "%PY_INST%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_launcher=0
    if !errorlevel! equ 0 ( echo %GREEN%[✓]%NC% Python 3.12 安装完成 ) else ( echo %RED%[✗]%NC% 安装失败，请手动安装: https://www.python.org/downloads/ & pause )
) else ( echo %RED%[✗]%NC% 下载失败，请手动安装: https://www.python.org/downloads/ & pause )
goto :EOF

:: ── 检测 Node.js ──────────────────────────────────────────────────────────
:CHECK_NODE
set "NODE_OK="
where node >nul 2>&1 || goto :EOF
for /f "tokens=1 delims=." %%v in ('node --version 2^>nul') do (
    set "_NMAJ=%%v"
    set "_NMAJ=!_NMAJ:v=!"
    set "_NMAJ=!_NMAJ:V=!"
    if !_NMAJ! GEQ 18 set "NODE_OK=1"
)
if not defined NODE_OK set "NODE_OK=1"
goto :EOF

:: ── 安装 Node.js ──────────────────────────────────────────────────────────
:INSTALL_NODE
echo !YELLOW![→]!NC! 正在安装 Node.js 20 LTS（通过 winget）...
winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
if !errorlevel! equ 0 (
    set "PATH=C:\Program Files\nodejs;!PATH!"
    echo !GREEN![✓]!NC! Node.js 安装完成 & goto :EOF
)
echo !YELLOW![!]!NC! winget 不可用，尝试下载 MSI 安装包...
set "NODE_INST=%TOOLS_DIR%\node-lts-installer.msi"
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.3/node-v20.18.3-x64.msi' -OutFile '%NODE_INST%' -UseBasicParsing" 2>nul
if exist "%NODE_INST%" (
    msiexec /i "%NODE_INST%" /quiet /norestart ADDLOCAL=ALL
    set "_MSI_ERR=!errorlevel!"
    :: 0=成功, 3010=需要重启但安装成功，均视为成功
    if !_MSI_ERR! equ 0 ( echo !GREEN![✓]!NC! Node.js 安装完成
    ) else if !_MSI_ERR! equ 3010 (
        echo !YELLOW![!]!NC! Node.js 安装完成（需要重启系统才能生效）
        :: 立即将默认安装路径加入当前进程 PATH
        set "PATH=C:\Program Files\nodejs;!PATH!"
    ) else ( echo !RED![✗]!NC! 安装失败 ^(错误码 !_MSI_ERR!^)，请手动安装: https://nodejs.org/ & pause )
) else ( echo !RED![✗]!NC! 下载失败，请手动安装: https://nodejs.org/ & pause )
goto :EOF

:: ── 检测 FFmpeg ───────────────────────────────────────────────────────────
:CHECK_FFMPEG
set "FFMPEG_OK="
where ffmpeg >nul 2>&1 && set "FFMPEG_OK=1"
if not defined FFMPEG_OK (
    if exist "%TOOLS_DIR%\ffmpeg\bin\ffmpeg.exe" (
        set "FFMPEG_OK=1"
        set "PATH=%TOOLS_DIR%\ffmpeg\bin;!PATH!"
    )
)
goto :EOF

:: ── 安装 FFmpeg ───────────────────────────────────────────────────────────
:INSTALL_FFMPEG
echo %YELLOW%[→]%NC% 正在安装 FFmpeg（通过 winget）...
winget install --id Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements >nul 2>&1
if !errorlevel! equ 0 ( echo %GREEN%[✓]%NC% FFmpeg 安装完成 & goto :EOF )
echo %YELLOW%[!]%NC% winget 不可用，下载便携版...
set "FFMPEG_ZIP=%TOOLS_DIR%\ffmpeg.zip"
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '%FFMPEG_ZIP%' -UseBasicParsing" 2>nul
if exist "%FFMPEG_ZIP%" (
    powershell -NoProfile -Command "Expand-Archive -Path '%FFMPEG_ZIP%' -DestinationPath '%TOOLS_DIR%\ffmpeg_raw' -Force" 2>nul
    for /d %%d in ("%TOOLS_DIR%\ffmpeg_raw\ffmpeg-*") do (
        if exist "%%d\bin\ffmpeg.exe" (
            if exist "%TOOLS_DIR%\ffmpeg" rd /s /q "%TOOLS_DIR%\ffmpeg"
            move "%%d" "%TOOLS_DIR%\ffmpeg" >nul
        )
    )
    rd /s /q "%TOOLS_DIR%\ffmpeg_raw" 2>nul & del "%FFMPEG_ZIP%" 2>nul
    if exist "%TOOLS_DIR%\ffmpeg\bin\ffmpeg.exe" (
        call :ENSURE_IN_PATH "%TOOLS_DIR%\ffmpeg\bin"
        set "PATH=%TOOLS_DIR%\ffmpeg\bin;!PATH!"
        echo %GREEN%[✓]%NC% FFmpeg 便携版安装至 storage\tools\ffmpeg\
    ) else ( echo %YELLOW%[!]%NC% FFmpeg 解压失败 )
) else ( echo %YELLOW%[!]%NC% FFmpeg 下载失败（视频功能不可用） )
goto :EOF

:: ── 确保路径已写入用户 PATH（持久化）──────────────────────────────────────
:ENSURE_IN_PATH
set "ADD_PATH=%~1"
if not exist "!ADD_PATH!" goto :EOF
echo !PATH! | find /i "!ADD_PATH!" >nul 2>&1 && goto :EOF
for /f "skip=2 tokens=3*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "CUR_USER_PATH=%%a %%b"
if defined CUR_USER_PATH ( setx PATH "!ADD_PATH!;!CUR_USER_PATH!" >nul 2>&1 ) else ( setx PATH "!ADD_PATH!" >nul 2>&1 )
set "PATH=!ADD_PATH!;!PATH!"
goto :EOF

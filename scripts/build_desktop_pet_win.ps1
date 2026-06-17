# Build desktop-pet on native Windows (MSVC + NSIS installer).
# Requires: Node.js, Rust, Visual Studio Build Tools, WebView2
param(
    [switch]$PortableOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PetDir = Join-Path $Root "desktop-pet"
$OutDir = Join-Path $Root "storage/outputs/desktop-pet-win"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Install Node.js first."
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo not found. Install Rust from https://rustup.rs"
}

$env:VITE_BACKEND_URL = if ($env:VITE_BACKEND_URL) { $env:VITE_BACKEND_URL } else { "http://127.0.0.1:8000" }
$env:VITE_CONSOLE_URL = if ($env:VITE_CONSOLE_URL) { $env:VITE_CONSOLE_URL } else { "http://127.0.0.1:3000/companion" }

Push-Location $PetDir
try {
    npm install
    if ($PortableOnly) {
        npm run tauri:build:win:gnu
    } else {
        npm run tauri:build:win
    }
} finally {
    Pop-Location
}

$ReleaseDir = Join-Path $PetDir "src-tauri/target/release"
$BundleDir = Join-Path $ReleaseDir "bundle"
$Exe = Join-Path $ReleaseDir "ai-media-agent-desktop-pet.exe"
$NsisDir = Join-Path $BundleDir "nsis"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (Test-Path $NsisDir) {
    $Installer = Get-ChildItem $NsisDir -Filter "*.exe" | Select-Object -First 1
    if ($Installer) {
        Copy-Item $Installer.FullName (Join-Path $OutDir $Installer.Name) -Force
        Write-Host "NSIS installer: $(Join-Path $OutDir $Installer.Name)"
    }
}

if (Test-Path $Exe) {
    $PortableZip = Join-Path $OutDir "AI-Media-Agent-Pet-win-portable.zip"
    $Stage = Join-Path $OutDir "staging-win"
    if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Stage | Out-Null
    Copy-Item $Exe (Join-Path $Stage "ai-media-agent-desktop-pet.exe")
    $Wv2 = Join-Path $ReleaseDir "WebView2Loader.dll"
    if (Test-Path $Wv2) {
        Copy-Item $Wv2 (Join-Path $Stage "WebView2Loader.dll")
    } else {
        Write-Warning "WebView2Loader.dll not found beside exe — pet may fail to start on Windows"
    }
    Copy-Item (Join-Path $PetDir "README.md") $Stage -ErrorAction SilentlyContinue
    @"
AI Media Agent 桌宠 (Windows)

1. 先启动 AI Media Agent 主应用（后端 http://127.0.0.1:8000）
2. 双击 ai-media-agent-desktop-pet.exe 运行桌宠
3. 系统托盘 / Alt+Shift+B 唤醒 · 右键菜单可关闭或退出
4. 需要 WebView2 运行时（Win10/11 通常已自带）
"@ | Set-Content -Path (Join-Path $Stage "使用说明.txt") -Encoding UTF8
    if (Test-Path $PortableZip) { Remove-Item $PortableZip -Force }
    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $PortableZip -Force
    Write-Host "Portable zip: $PortableZip"
}

Write-Host "Done."

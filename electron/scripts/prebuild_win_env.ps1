# Build prebuilt Windows venv for Electron packaging (offline wheels).
# Run from repo root after build_win.sh Step 0c+/0d:
#   powershell -ExecutionPolicy Bypass -File electron/scripts/prebuild_win_env.ps1
#
# Or use the cross-platform wrapper (Wine on macOS):
#   bash electron/scripts/bundle_venv_prebuilt_win.sh
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ResPython = Join-Path $Root "electron\resources\python\runtime"
$VenvOut = Join-Path $Root "electron\resources\python\venv-prebuilt"
$Wheels = Join-Path $Root "electron\resources\pip-wheels-win"
$Req = Join-Path $Root "backend\requirements.txt"
$Py = Join-Path $ResPython "python.exe"
$Stamp = Join-Path $VenvOut ".venv-prebuilt.stamp"

if (-not (Test-Path $Py)) {
    Write-Error "Missing $Py — run build_win.sh Step 0c+ first"
}
if (-not (Test-Path $Req)) {
    Write-Error "Missing $Req"
}
$wheelCount = (Get-ChildItem -Path $Wheels -Filter *.whl -ErrorAction SilentlyContinue | Measure-Object).Count
if ($wheelCount -lt 5) {
    Write-Error "Need pip-wheels-win (>=5 wheels) — run bundle_pip_wheels_win.sh first"
}

if (Test-Path $VenvOut) { Remove-Item -Recurse -Force $VenvOut }
& $Py -m venv $VenvOut --copies
$VenvPy = Join-Path $VenvOut "Scripts\python.exe"

& $VenvPy -m pip install `
  --no-index `
  --find-links $Wheels `
  -r $Req `
  --prefer-binary `
  --no-warn-script-location

& $VenvPy -c "import uvicorn, fastapi, pandas, openpyxl"

$reqHash = (Get-FileHash $Req -Algorithm SHA256).Hash.ToLower()
$wheelsHash = (Get-Content (Join-Path $Wheels ".requirements.sha256") -ErrorAction SilentlyContinue | Select-Object -First 1)
@"
req=$reqHash
wheels=$wheelsHash
built=$(Get-Date -Format o)
"@ | Set-Content -Encoding utf8 $Stamp

Write-Host "Prebuilt venv → $VenvOut"

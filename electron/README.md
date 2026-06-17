# AI Media Agent – macOS Desktop App

Electron wrapper that bundles all 5 services into a single `.dmg` installer.

## Services managed

| Service           | Port  | Tech             |
| ----------------- | ----- | ---------------- |
| FastAPI backend   | 8000  | Python / uvicorn |
| OCR service       | 50051 | Python / gRPC    |
| Parser service    | 50052 | Rust / gRPC      |
| Directory service | 50053 | Go / gRPC        |
| Next.js frontend  | 3000  | Node.js          |

## Prerequisites (on the build machine)

```
Go    1.22+   brew install go
Rust  1.75+   rustup
Node  18+     brew install node
Python 3.10+  brew install python@3.12
```

## Build

```bash
# From project root:
cd electron

# Universal (arm64 + x64) – recommended
./build_mac.sh

# Single-arch
./build_mac.sh arm64
./build_mac.sh x64
```

Output → `electron/dist/AI Media Agent-*.dmg`

## Development (no build)

```bash
cd electron
npm install
npm start     # launches Electron in dev mode against live services
```

In dev mode the app expects the services to already be running
(`./start_local.sh` from the project root) because it skips the
first-run setup wizard.

## Project layout

```
electron/
├── main.js               # Electron main process (service manager)
├── preload.js            # contextBridge IPC preload
├── package.json          # electron-builder config
├── build_mac.sh          # full build script
├── scripts/
│   └── create_icons.py   # generates tray PNGs + icon.icns
├── renderer/
│   ├── status.html / .js # service status window
│   └── setup.html  / .js # first-run setup progress window
└── resources/            # populated by build_mac.sh
    ├── bin/              # compiled Go/Rust binaries
    ├── icons/            # tray & app icons
    ├── backend/          # Python backend source
    ├── ocr-service/      # OCR Python source
    └── web-standalone/   # Next.js standalone output
```

## First-run setup (end-user)

On first launch the app:

1. Copies backend source to `~/Library/Application Support/AI Media Agent/`
2. Creates a Python virtualenv and runs `pip install -r requirements.txt`
3. Installs Playwright Chromium (for browser automation tools)
4. Starts all 5 services automatically

Subsequent launches are instant (venv is cached).

## Configuration

After first launch, edit the `.env` file at:

```
~/Library/Application Support/AI Media Agent/backend/.env
```

Add your LLM API key, e.g.:

```
ZHIPUAI_API_KEY=sk-...
```

Then restart services via the system tray menu.

## Gatekeeper (unsigned app)

Because this app is unsigned you may see "app is damaged" on macOS 13+.
Remove the quarantine flag with:

```bash
xattr -rd com.apple.quarantine "/Applications/AI Media Agent.app"
```

Then open normally.

## Logs

Service logs are written to:

```
~/Library/Application Support/AI Media Agent/logs/
```

View them from the system tray → View Logs, or directly in Finder.

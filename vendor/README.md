# Vendor dependencies

## CodeGraph (`vendor/codegraph`)

Git submodule: [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)

First-time setup (from repo root):

```bash
./scripts/setup_codegraph.sh
```

This initializes the submodule, installs npm deps, and runs `npm run build` to produce `vendor/codegraph/dist/`.

Electron packaging copies `dist/` to `electron/resources/codegraph/` automatically (`build_mac.sh` / `build_win.sh` Step 4c).

Override path: `CODEGRAPH_HOME=/path/to/codegraph`

Fallback if `vendor/codegraph` is not built: global `codegraph` CLI or `npx @colbymchenry/codegraph`.

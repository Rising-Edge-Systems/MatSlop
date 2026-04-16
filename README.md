# MatSlop

Open-source MATLAB alternative IDE powered by GNU Octave.

## Features

- **Editor** — Monaco-based editor with MATLAB syntax highlighting, multiple tabs, auto-complete
- **Live Scripts** — Notebook-style `.mls` files with code cells, markdown cells, and inline plots
- **Interactive Plots** — 2D and 3D plots rendered with Plotly.js (pan, zoom, rotate, data cursors)
- **Debugger** — Breakpoints, conditional breakpoints, step over/into/out, call stack, watches
- **Command Window** — Interactive Octave REPL with history
- **Workspace** — Live variable viewer with inline inspection
- **File Browser** — Navigate directories, open files, drag-and-drop
- **Dockable Panels** — Rearrange panels via drag-and-drop, detach to floating windows
- **Session Restore** — Tabs, layout, and cursor positions persist across restarts
- **Auto-Update** — In-app update notifications when new versions are available
- **Bundled Octave** — Ships with GNU Octave on Windows and Linux (no separate install needed)

## Quick Start

Download the latest installer from [Releases](https://github.com/Rising-Edge-Systems/MatSlop/releases).

## Development

```bash
npm install
npm run dev
```

### Build

```bash
npm run build:win    # Windows .exe installer
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage + .deb
```

Note: Run `npm run download:octave` first to bundle Octave with the installer.

### Test

```bash
npm test             # Unit tests (vitest)
npm run test:e2e     # E2E tests (Playwright)
npm run typecheck    # TypeScript check
```

## Releasing

See [RELEASING.md](RELEASING.md).

## License

MIT

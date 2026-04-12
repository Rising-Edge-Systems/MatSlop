# Known Limitations

Current state as of the 6-cycle polish pass (136 commits on `main`).
586 unit tests pass, typecheck clean, lint clean.

---

## Critical — Affects First Impression

### Workspace panel shows "No variables in workspace" after fresh launch
The very first `octaveExecute('whos')` after a renderer reload sometimes
hangs inside the main-process command queue (the IPC promise never
resolves). A 2-second watchdog + 1.5-second per-call timeout race keep
the panel self-healing — after the watchdog fires, subsequent command
executions trigger a refresh that works correctly. Typical user impact:
the workspace is blank for ~2s after launch, then populates normally on
the first typed command.

**Root cause:** OctaveProcessManager's init-handshake sometimes does not
drain the command queue after the first delimiter arrives, despite the
`setImmediate(processQueue)` fix in US-T02. The race appears to be
timing-dependent (Octave startup speed vs. renderer mount order).

**Workaround:** Type any command in the Command Window — the workspace
refreshes immediately.

### Plotting does not work in the extracted-deb dev environment
`plot()` / `surf()` / etc. fail with `ft_text_renderer: invalid bounding
box` because the extracted Octave 8.4 debs lack the correct fontconfig
chain for Freetype glyph rendering. This is **not a MatSlop bug** — it's
an artifact of running Octave from extracted `.deb` packages without a
system-level `apt install`. A proper `apt install octave` or the bundled
Windows/macOS Octave avoids this entirely.

### `download-octave.js --platform linux` does not bundle Octave
The upstream octave-appimage project (ryanjdillon/octave-appimage) does
not exist. US-S01 replaced the broken URL with a clean exit + a message
directing users to `apt install octave`. Linux users must install Octave
via their package manager; Windows and macOS bundling works.

---

## Moderate — Noticeable During Use

### Plotting pipeline verified end-to-end except real Octave rendering
US-L08 verified the full plotting pipeline through mock-data integration
tests covering: `matslop_export_fig` loadability (Octave confirms the
function parses), JSON schema round-trip (`parsePlotFigure` →
`figureToPlotly` for line/surface/scatter/bar), capture script marker
parsing (`__MATSLOP_FIG__` / `__MATSLOP_PWD__` regex), FigurePanel PNG
data-URL construction, and IPC `figures:readImage` base64 round-trip.
27 tests in `tests/integration/plotting-pipeline.test.ts` cover these
paths.

**What remains unverified:** Real Octave `plot()` → `print()` → PNG
export. The extracted-deb dev environment (Octave 8.4 at
`/tmp/octave-root/octave-cli-wrap`) fails with `ft_text_renderer:
invalid bounding box` because the extracted `.deb` packages lack
`fonts-freefont-otf` and we cannot `sudo apt install` in the sandboxed
environment. The hardcoded font path (`/usr/share/fonts/opentype/
freefont/FreeSans.otf`) in the Octave binary cannot be overridden via
`FONTCONFIG_FILE`. A proper `apt install octave` or the bundled
Windows/macOS Octave distribution avoids this entirely.

### Debugger UI verified against real Octave 8.4
US-L07 verified and fixed the debugger pipeline. `parsePausedMarker` now
captures Octave 8.4's bracketed full path format (`[/path/to/file.m]`).
Integration tests in `tests/integration/debugger-octave.test.ts` cover
the full dbstop → pause → dbstep → dbcont cycle against real Octave.

### Capture script and workspace refresh serialized (fixed)
US-L04 serialized the capture script and workspace refresh in
`runCaptureAndRefresh()`. The capture script now fully completes before
`whos` is triggered, eliminating the race condition on slower systems.

### Session restore verified after rc-dock migration (fixed)
US-L06 verified session save/restore round-trips correctly after the
rc-dock migration. 16 tests in `tests/unit/session-restore-roundtrip.test.ts`
cover layout serialization, editor tab restore, and graceful degradation
for corrupted or pre-migration session files.

### macOS / Windows builds not tested
US-038 through US-042 (download scripts, code signing, notarization,
auto-update) were implemented by ralph against the codebase but never
run on actual macOS or Windows hardware. The `build:mac` and `build:win`
npm scripts should work but are untested in this cycle.

---

## Minor — Cosmetic / Polish

### Busy indicator wired up (fixed)
US-L01 wired up the busy indicator by calling `wrapOctaveExecute()` in
`main.tsx` before `ReactDOM.createRoot`. The status bar now shows
"Running..." during commands that take >250ms. The Proxy approach
bypasses Electron's frozen `contextBridge` object.

### Tab strip active state is always "all active"
Each dock panel has exactly one tab, so the active-tab styling (accent
underline + bright text) applies to every visible tab. In panels with
2+ tabs (e.g. Command Window + History), only the front tab has the
active style — this is correct but looks uniform when every panel has
a single tab.

### `download-octave.js --platform darwin` pins to Octave 9.2
The latest `octave-app` release is v9.2, not the v9.4.0 the script
originally targeted. The macOS download URL was pinned to 9.2 in
US-S01. When `octave-app` ships a newer release, update the constant
in `scripts/download-octave.js`.

### Welcome file changed to runnable plain script (fixed)
US-L05 verified the welcome file was changed from a function stub to a
runnable plain script. Clicking Run (F5) now produces visible output.

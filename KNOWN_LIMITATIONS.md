# Known Limitations

Current state after the `ralph/fix-known-limitations` branch.
651 unit tests pass, typecheck clean, lint clean.

---

## Resolved in this cycle

### ~~Workspace panel shows "No variables in workspace" after fresh launch~~ (fixed)
**Root cause:** OctaveProcessManager's init-handshake didn't drain the
command queue after the first delimiter arrived (US-T02 fix), AND
WorkspacePanel received `engineStatus` as a frozen prop through rc-dock's
loadTab cache, so it stayed 'disconnected' even after Octave started.

**Fix:** US-L02 introduced `AppContext` for dynamic panel state. US-L03
hardened the workspace refresh (removed 1.5s timeout race, single 500ms
retry safety net). WorkspacePanel now reads `engineStatus` from
`OctaveContext` which bypasses rc-dock's stale prop cache.

### ~~rc-dock stale closures~~ (fixed)
**Root cause:** rc-dock's `loadTab` factory caches React elements. Props
passed through the factory were frozen at initial mount. `contentVersion`
forced full layout rebuilds but destroyed component state.

**Fix:** US-L02 created `AppContext` (help state, profiler state, cwd).
Panel components read dynamic state from context instead of props.
`contentVersion` removed — layout only rebuilds on visibility/detached
changes. WorkspacePanel and CommandWindow read `engineStatus` from
`OctaveContext`.

### ~~Busy indicator disabled~~ (fixed)
**Fix:** The preload script wraps `octaveExecute` with begin/end callbacks
registered by the renderer via `registerBusyCallbacks()`. This bypasses
Electron's `contextBridge` freeze (which makes `window.matslop` read-only).
The status bar shows "Running..." during commands that take >250ms.

### ~~Capture script races with workspace refresh~~ (fixed)
**Fix:** US-L04 serialized the capture script (pwd + figure detection) and
workspace refresh in `runCaptureAndRefresh()`. The capture script completes
before `whos` is triggered, eliminating the race.

### ~~Session restore not verified~~ (fixed)
**Fix:** US-L06 verified session save/restore round-trips correctly after
rc-dock migration. 16 tests cover layout serialization, editor tab restore,
and graceful degradation for corrupted or pre-migration session files.

### ~~Debugger not live-verified~~ (fixed)
**Fix:** US-L07 fixed `parsePausedMarker` to extract Octave 8.4's bracketed
full path format (`[/path/to/file.m]`). Integration tests cover the full
dbstop → pause → dbstep → dbcont cycle against real Octave.

### ~~Welcome file is function stub~~ (fixed)
The welcome file was changed from `function result = hello()` to a plain
script that produces visible output when run with F5.

---

## Remaining — Environment-Specific

### Plotting does not work in the extracted-deb dev environment
`plot()` / `surf()` / etc. fail with `ft_text_renderer: invalid bounding
box` because the extracted Octave 8.4 debs lack the correct fontconfig
chain for Freetype glyph rendering. This is **not a MatSlop bug** — it's
an artifact of running Octave from extracted `.deb` packages without a
system-level `apt install`. A proper `apt install octave` or the bundled
Windows/macOS Octave avoids this entirely.

The plotting pipeline was verified end-to-end via 27 mock-data integration
tests (US-L08): `matslop_export_fig` loads in Octave, JSON schema
round-trips work, capture script marker parsing works, FigurePanel PNG
construction works.

### `download-octave.js --platform linux` does not bundle Octave
The upstream octave-appimage project does not exist. Linux users must
install Octave via their package manager; Windows and macOS bundling works.

### macOS / Windows builds not tested
`build:mac` and `build:win` npm scripts should work but are untested on
actual macOS or Windows hardware.

---

## Minor — Cosmetic

### Tab strip active state is always "all active"
Each dock panel has exactly one tab, so the active-tab styling applies to
every visible tab uniformly. Correct behavior but looks uniform.

### `download-octave.js --platform darwin` pins to Octave 9.2
When `octave-app` ships a newer release, update the constant in
`scripts/download-octave.js`.

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

### Interactive 3D plots (Plotly.js) not verified end-to-end
US-007 through US-013 implemented `matslop_export_fig`, `PlotRenderer`,
and the Plotly.js integration. Unit tests pass, but the full pipeline
(Octave figure → JSON export → Plotly render in the editor) has not been
live-tested because the dev environment lacks a working Octave graphics
toolkit. The code paths exist and compile; they need verification on a
system with a functional `gnuplot` or `qt` toolkit.

### Debugger UI wired but not live-exercised
US-014 through US-023 landed breakpoint gutter, debug toolbar, call
stack panel, watches panel, conditional breakpoints, and
edit-and-continue (best effort). All passed ralph's unit/integration
tests during the roadmap cycle. Live verification against a real Octave
`dbstop`/`dbcont` session was not performed in this polish pass.

### `handleCommandExecuted` capture script races with workspace refresh
After every user command, `App.tsx` runs a multi-line capture script
(`__mslp_r__=pwd(); ...`) to detect figures and update the CWD. This
IPC runs concurrently with the workspace panel's `whos` refresh. On
fast systems both resolve cleanly; on slower systems the `whos` may
return empty because the capture script is still holding the Octave
command slot. The retry loop (up to 3x with 120ms delays) mitigates
this in most cases.

### Session restore (`session.json`) not verified after the rc-dock migration
US-034 added session save/restore (open tabs, cursor, layout). The
polish cycles migrated the layout system from Allotment to rc-dock and
added a layout version bump (US-Q07). Persisted sessions from the
Allotment era are discarded on upgrade, which is correct. New sessions
may or may not serialize all rc-dock state (floating panels, tab order)
— not tested.

### macOS / Windows builds not tested
US-038 through US-042 (download scripts, code signing, notarization,
auto-update) were implemented by ralph against the codebase but never
run on actual macOS or Windows hardware. The `build:mac` and `build:win`
npm scripts should work but are untested in this cycle.

---

## Minor — Cosmetic / Polish

### Busy indicator (US-S02) is disabled at runtime
The ref-counted "Running..." status bar indicator was implemented but
its monkey-patch of `window.matslop.octaveExecute` conflicts with
Electron's frozen `contextBridge` object. The tracker module
(`octaveBusyTracker.ts`) still exists and exports `begin()/end()` for
direct callers, but the auto-wire in `main.tsx` was removed. The status
bar stays on "Ready" during short commands. Long-running commands can
be stopped via the Stop button (verified working).

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

### Editor welcome file is `untitled.m` with a demo function
On first launch the editor opens with a `function result = hello()`
stub. Clicking Run (F5) on this shows a "This file only defines
function(s); nothing to run" banner (US-S05). Users may be confused
by this — a plain-script welcome (without `function`) would be more
intuitive.

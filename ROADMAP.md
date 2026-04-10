# MatSlop Roadmap

Goal: feature parity with MATLAB's core IDE (no toolboxes/addons), with a familiar look and feel.

## Current State

**Working:**
- Bundled GNU Octave 9.4 (self-contained install, no user setup)
- Command window (prompt, history, copy, interrupt)
- Editor with multi-tab, Monaco, MATLAB syntax, auto-resize
- File browser, workspace panel, figure panel
- `.m` and `.mls` (text-based live script) open/save
- Live script cells with code/markdown
- Per-plot-group figure capture (plot/surf/bar/quiver3/etc. → inline PNG)
- 2D pan/zoom plot viewer with toolbar (home/zoom/fit/save)
- Theme switching, layout persistence, recent files
- 83 automated tests (unit + integration + Playwright E2E)

**Known gaps from MATLAB:**
- No true 3D rotation on plots
- Cell outputs trapped inside cell bounds (not continuous MLX-style column)
- No debugger (breakpoints, step, pause, continue)
- Cell drag-drop reorder is broken
- Command window layout is awkward (competes with workspace)
- No dockable/detachable panels
- No rich data tooltips on plots

---

## Phase 1 — Layout Fixes (priority: high, est: 1-2 days)

**Goal:** the window layout should feel right before we build more on top of it.

- [ ] **Command Window below editor only.** Currently it's in a pane that competes with the workspace. Restructure the Allotment tree so the bottom pane (command window + figure panel) is *only* under the editor column, not across the workspace. Workspace + file browser stack vertically on their own side.
- [ ] **Default layout: File Browser (left) | Editor (center) + Command Window (below editor) | Workspace (right).** This matches MATLAB's default.
- [ ] **Fix cell reorder drag-drop.** Investigate why drag handles don't move cells — likely an `e.preventDefault()` or drop-zone hit-testing issue. Add a Playwright test that drags cell 2 above cell 1 and verifies order.
- [ ] **Save/restore per-panel sizes** (already partly there, verify).

Deliverable: MATLAB-like default layout, working cell reordering, E2E tests for each.

---

## Phase 2 — Continuous Output Region (priority: high, est: 3-4 days)

**Goal:** MLX-style layout where *all* cell outputs live in a single flowing column on the right of *all* cell code on the left. The current design nests outputs inside each cell which causes awkward sizing.

**Approach:** refactor to a CSS grid where:
- Left column = code for all cells, stacked
- Right column = outputs for all cells, stacked
- Each cell's output is anchored to its code via `grid-row` (so they line up at the top of each cell)
- Both columns scroll together
- The cell's *visible boundary* (grip, run button, type badge) still wraps the code section, but outputs float in a shared right track

Tasks:
- [ ] Prototype the grid layout on a fresh fixture
- [ ] Move `StatementResultsColumn` from inside each cell into a sibling right track
- [ ] Wire up hover effects so code/output pairs highlight together
- [ ] Handle add-cell buttons (currently between cells) — need to span both columns
- [ ] Handle cell drag-drop across the grid layout
- [ ] Regression tests against `multiplot.mls` and `quiver3.mls` fixtures

---

## Phase 3 — True 3D Plot Interaction (priority: high, est: 5-7 days)

**Goal:** rotate, zoom, pan 3D plots (and 2D) with mouse, matching MATLAB's figure interactivity.

**Approach A — Re-render via Octave (pragmatic, ships fastest):**
- On figure capture, store the **figure's metadata** (type, axis limits, view azimuth/elevation) alongside the PNG
- Plot viewer shows the PNG statically
- When user drags to rotate: debounce, then send `view(az, el); print(...)` to Octave, swap in the new PNG
- During drag: use CSS rotation interpolation for smoothness, snap to a real frame on release
- Persist figure handles across the cell run (don't `close` them) so they can be re-rendered

**Approach B — SVG + client-side rotation (cleaner for 2D, harder for 3D):**
- `print` supports `-dsvg`. SVG is DOM-manipulable.
- For 2D: pan/zoom becomes trivial DOM transforms
- For 3D: SVG still needs Octave re-rendering

**Decision: Do A first, ship 3D rotation, then layer on B for 2D polish.**

Tasks:
- [ ] Keep figure handles alive across runs (new figure per run, but don't close at end)
- [ ] Store per-figure metadata when capturing (az/el, view box, is3d)
- [ ] Add IPC `figure:rerender(handle, {az, el, xlim, ylim, zlim})` that prints a fresh PNG
- [ ] Detect mouse drag over a plot → rotate via Octave (debounced)
- [ ] Add rotate3d / zoom / pan / data-tip tool buttons (already have zoom/pan for 2D)
- [ ] Figure window detach: double-click or button to open in its own OS window with full controls

---

## Phase 4 — Debugger (priority: medium-high, est: 7-10 days)

**Goal:** set breakpoints, pause on hit, step line-by-line, inspect variables mid-execution.

**Octave primitives we hook into:**
- `dbstop in "file.m" at LINE`
- `dbclear in "file.m" at LINE`
- `dbstep` / `dbstep in` / `dbstep out`
- `dbcont`
- `dbquit`
- `dbstatus` (list breakpoints)
- `dbstack` (call stack)
- When stopped, Octave's stderr emits `stopped in <file> at line <N>`

Tasks:
- [ ] Add breakpoint gutter to Monaco editor (click to toggle)
- [ ] IPC: `debug:setBreakpoint`, `debug:clearBreakpoint`, `debug:step`, `debug:continue`, `debug:stop`
- [ ] Parse Octave debug-mode output to detect pause events
- [ ] UI: debug toolbar (step over, step in, step out, continue, stop)
- [ ] Highlight current execution line in the editor
- [ ] Call stack panel (new UI panel)
- [ ] Variables at breakpoint (already have workspace — just refresh on pause)
- [ ] "Pause execution" button when running — sends SIGINT + `dbquit` to stop the current operation

---

## Phase 5 — Dockable/Detachable Panels (priority: medium, est: 5-7 days)

**Goal:** rearrange panels like MATLAB. Drag tabs between docks, pop panels out into separate OS windows.

Tasks:
- [ ] Introduce a dock manager (candidate libraries: `rc-dock`, `flexlayout-react`)
- [ ] Migrate existing panels to dock nodes
- [ ] Persist dock state per user
- [ ] "Detach to new window" button per panel — spawns a new BrowserWindow
- [ ] Layout presets: Default, Two-Column, Code-only, Debug
- [ ] Reset-to-default menu item

---

## Phase 6 — Missing MATLAB Features (ongoing)

Smaller items, no particular order:

- [ ] **Data tips / cursors on plots** — click a plot point, see `(x, y, z)` value
- [ ] **Variable editor** — double-click workspace var → spreadsheet-like grid edit (partially there via `VariableInspectorDialog`, needs polish)
- [ ] **Code sections (`%%`)** in `.m` files with run-section button (MATLAB's cell-mode for scripts)
- [ ] **Publish** — export `.m` or `.mls` to HTML/PDF with rendered output
- [ ] **Find & Replace** across files (currently only current file)
- [ ] **Help browser** — `doc functionName` → rendered documentation
- [ ] **Profiler** — integrate with Octave's `profile on/off/report`
- [ ] **Git integration** — status in file browser, diff viewer, commit/stage UI
- [ ] **Session save/restore** — reopen last-open tabs on launch (avoid the "reopen every dev restart" pain)
- [ ] **Settings UI polish** — add font/keybinding/live-script-defaults sections
- [ ] **Keyboard shortcut editor** (currently hardcoded)

---

## Phase 7 — Packaging & Distribution (est: 2-3 days)

- [ ] Windows installer (NSIS, already wired up via electron-builder)
- [ ] macOS `.dmg` build path — needs bundled Octave for mac (download script extension)
- [ ] Linux AppImage — needs bundled Octave for linux
- [ ] Auto-update channel
- [ ] Signed builds (code signing cert needed on Windows/mac)

---

## Priority ordering

```
Phase 1 (layout) → Phase 2 (continuous outputs) → Phase 3 (3D rotation)
                                                       ↓
Phase 5 (dockable) ← Phase 4 (debugger) ←─────────────┘
                          ↓
                    Phase 6 (smaller items, opportunistic)
                          ↓
                    Phase 7 (packaging)
```

Phase 1 is immediate — small scope, unblocks comfortable day-to-day use.
Phase 2 + 3 together are the biggest "feels like MATLAB" wins.
Phase 4 is the hardest single chunk but highest-value for serious use.

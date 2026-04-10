# PRD: MatSlop — MATLAB Feature-Parity Roadmap

## Introduction

MatSlop is an open-source, free desktop IDE aiming to provide MATLAB-equivalent functionality (core features, not toolboxes/addons) with a familiar look and feel. It wraps GNU Octave as its computational engine and ships as a self-contained Electron app.

This PRD covers the complete roadmap across seven phases, bringing MatSlop from its current state (working editor/command window/basic plotting) to a production-ready MATLAB alternative with interactive 3D plots, a full debugger, dockable panels, and cross-platform packaging.

## Goals

- Match MATLAB's IDE feel: familiar layout, familiar interactions, dark-theme polish
- Give users full interactivity with their plots (rotate 3D, zoom, pan, data cursors)
- Provide a real debugger: breakpoints, stepping, conditional breakpoints, watches, call stack
- Support MATLAB's multi-pane dock layout with drag-and-drop panel rearrangement
- Ship signed installers for Windows (first), then macOS and Linux
- Keep zero-config onboarding: bundled Octave, no external downloads required
- Maintain the test discipline already in place (unit + integration + Playwright E2E)

## Non-Goals

- No toolbox/addon marketplace (Simulink, Signal Processing Toolbox, etc.)
- No Live Editor tasks ("interactive tasks" in MLX)
- No cloud sync / MathWorks account integration
- No MATLAB Grader / classroom features
- No real-time hardware I/O (Arduino/Raspberry Pi toolboxes)
- No `.mlx` binary format support (we intentionally use text-based `.mls`)
- No custom MATLAB parser — we defer all execution semantics to Octave
- No telemetry or analytics
- No replacement of MATLAB's specific function implementations — Octave's behavior is authoritative
- No backward compatibility with stored `.mls` files during major format refactors (migrations only where cheap)

## User Stories

### Phase 1 — Layout Fixes

#### US-001: Restructure main layout so Command Window is below the Editor only
**Description:** As a user, I want the Command Window to sit directly beneath the editor so it doesn't compete with the Workspace or File Browser for horizontal space.

**Acceptance Criteria:**
- [ ] Default layout: File Browser (left), Editor (center-top) with Command Window (center-bottom), Workspace (right)
- [ ] Command Window does NOT extend under the File Browser or Workspace columns
- [ ] Resizing the editor vertically shrinks/grows the Command Window
- [ ] Layout persistence still works after this restructure
- [ ] Existing layout regression tests pass
- [ ] Verify in Playwright E2E test that the Command Window's bounding box is horizontally contained within the editor column

#### US-002: Fix live-script cell drag-and-drop reordering
**Description:** As a user, I want to drag cells by their grip handle to reorder them in a live script.

**Acceptance Criteria:**
- [ ] Grabbing the grip handle and dragging a cell moves it above/below other cells
- [ ] Drop zones highlight during drag
- [ ] Cell order change persists to the `.mls` file on save
- [ ] Playwright test: drag cell 2 above cell 1 and assert DOM order changed
- [ ] Outputs follow their cells (no orphaned results after reorder)

#### US-003: Apply MATLAB-default layout preset on first launch
**Description:** As a new user, I want the initial layout to match MATLAB's defaults so I feel at home.

**Acceptance Criteria:**
- [ ] First-run layout: File Browser left, Editor + Command Window center, Workspace right
- [ ] "Reset Layout" menu item restores this default
- [ ] Verify layout via Playwright snapshot of main-window bounding boxes

---

### Phase 2 — Continuous Output Region (MLX-style)

#### US-004: Refactor live script to CSS grid with global code and output tracks
**Description:** As a user, I want outputs to flow continuously in a single right-side column across all cells, like MATLAB's Live Editor, instead of being trapped inside each cell box.

**Acceptance Criteria:**
- [ ] Live script renders as a 2-column CSS grid: code on left, outputs on right
- [ ] All cells stack vertically in both columns
- [ ] Each cell's output pairs align with its code row using `grid-row`
- [ ] Outputs no longer nested inside the cell container
- [ ] Hovering a cell highlights both its code and its output region
- [ ] Regression: existing fixtures (`multiplot.mls`, `quiver3.mls`) still render correctly

#### US-005: Preserve cell gutter (run button, grip, delete) in grid layout
**Description:** As a user, I want the per-cell controls (run, drag, delete) still attached to each code section in the new grid layout.

**Acceptance Criteria:**
- [ ] Run button appears in the code column at the cell header
- [ ] Drag handle remains functional across the grid layout
- [ ] Delete button accessible per cell
- [ ] "Add cell" buttons appear between rows, spanning both columns

#### US-006: Continuous output column scrolls with code column
**Description:** As a user, when I scroll the live script, both the code and output columns scroll together.

**Acceptance Criteria:**
- [ ] Vertical scroll is at the grid-container level, not per-cell
- [ ] Outputs wider than their code row do not push neighbors out of alignment
- [ ] Very tall outputs cause the row to expand, not overflow

---

### Phase 3 — True 3D Plot Interaction (JS library)

#### US-007: Extract plot data from Octave as JSON
**Description:** As a developer, I need to convert Octave figure state into a serialized JSON representation so a JavaScript library can re-render it interactively.

**Acceptance Criteria:**
- [ ] Implement an Octave function (bundled .m file) `matslop_export_fig(h)` that walks the figure handle and emits JSON describing axes, lines, surfaces, meshes, labels, colors, view angles, limits
- [ ] Supports: `plot`, `plot3`, `scatter`, `scatter3`, `surf`, `mesh`, `quiver`, `quiver3`, `bar`, `bar3`, `contour`, `contour3`, `imagesc`
- [ ] JSON schema documented in `src/main/plotSchema.ts`
- [ ] Unit tests: feed sample figures → verify JSON structure

#### US-008: Choose and integrate a JS 3D plotting library
**Description:** As a developer, I need a JS library that can render the extracted plot data as an interactive 3D canvas.

**Acceptance Criteria:**
- [ ] Evaluate Plotly.js and Three.js (pros/cons written in a short ADR)
- [ ] Recommendation: **Plotly.js** (covers 2D + 3D, has rotate/zoom/pan built-in, smaller integration cost than Three.js)
- [ ] Add dependency, verify bundle size impact documented
- [ ] Write a `PlotRenderer` React component that accepts the JSON schema and renders a Plotly figure

#### US-009: Replace static PNG plots with interactive renderer in live scripts
**Description:** As a user, I want to rotate, zoom, and pan plots with my mouse directly in the live script output.

**Acceptance Criteria:**
- [ ] Live script cells use `PlotRenderer` instead of PNG `InteractivePlot`
- [ ] 3D plots are rotatable by mouse drag
- [ ] 2D and 3D plots are zoomable with scroll wheel
- [ ] Panning with Shift+drag (or middle-click drag)
- [ ] Home button resets view
- [ ] Playwright test: open `quiver3.mls`, verify a Plotly canvas renders with interactive controls

#### US-010: Data cursor / tooltip on plot points
**Description:** As a user, I want to click a point on a plot and see its `(x, y, z)` value, like MATLAB's data cursor mode.

**Acceptance Criteria:**
- [ ] Hovering a data point shows a tooltip with coordinates
- [ ] Clicking pins the tooltip until clicked away
- [ ] Works for 2D and 3D plots

#### US-011: Export current plot view as PNG/SVG
**Description:** As a user, I want to save the interactive plot as it currently looks (including my rotation) to a file.

**Acceptance Criteria:**
- [ ] Save button exports current Plotly canvas as PNG and SVG
- [ ] Default filename derived from figure title
- [ ] Dialog lets user pick format

#### US-012: Detached plot window
**Description:** As a user, I want to pop a plot out into its own OS window for larger-screen interaction.

**Acceptance Criteria:**
- [ ] Button on plot toolbar opens plot in a new BrowserWindow
- [ ] Detached window is fully interactive (same controls)
- [ ] Closing the detached window returns focus to main window

#### US-013: Handle plot export failures gracefully
**Description:** As a user, if Octave can't serialize a figure (unsupported type), I want to see a clear message instead of a broken UI.

**Acceptance Criteria:**
- [ ] If `matslop_export_fig` fails, fall back to PNG rendering with a warning banner
- [ ] Warning explains which plot type is unsupported and links to a help doc
- [ ] No crash, no empty canvas

---

### Phase 4 — Full Debugger

#### US-014: Add breakpoint gutter to Monaco editor
**Description:** As a user, I want to click in the margin beside a line number to set a breakpoint.

**Acceptance Criteria:**
- [ ] Monaco glyph margin enabled on `.m` files
- [ ] Click in margin toggles a red breakpoint dot
- [ ] Breakpoint state persists in a tab-level store
- [ ] IPC `debug:setBreakpoint(filePath, line)` called on toggle
- [ ] Visual feedback: breakpoint dot appears/disappears immediately

#### US-015: Translate breakpoint actions to Octave dbstop commands
**Description:** As a developer, I need the main process to translate UI breakpoint state into Octave `dbstop in ... at ...` commands.

**Acceptance Criteria:**
- [ ] `debug:setBreakpoint(file, line)` sends `dbstop in "file.m" at LINE`
- [ ] `debug:clearBreakpoint(file, line)` sends `dbclear in "file.m" at LINE`
- [ ] Breakpoints survive file save and Octave restart (reapplied on reconnect)
- [ ] Unit test with mocked process manager verifies correct command strings

#### US-016: Detect and surface "execution paused" events
**Description:** As a user, when my script hits a breakpoint, I want the UI to show I'm in debug mode and highlight the paused line.

**Acceptance Criteria:**
- [ ] `OctaveProcessManager` parses stderr/stdout for Octave's "stopped in ... at line N" markers
- [ ] Emits a `paused` event with file path + line number
- [ ] Editor scrolls to the paused line and highlights it with a green arrow
- [ ] Status bar changes to indicate "Debug: paused"

#### US-017: Debug toolbar (continue, step over, step in, step out, stop)
**Description:** As a user, when execution is paused, I want buttons to continue, step to the next line, step into a function, step out, or stop the debugger entirely.

**Acceptance Criteria:**
- [ ] Toolbar appears when paused, hidden otherwise
- [ ] Buttons map to Octave commands: `dbcont`, `dbstep`, `dbstep in`, `dbstep out`, `dbquit`
- [ ] Each button sends the corresponding command
- [ ] Toolbar keyboard shortcuts: F5 continue, F10 step over, F11 step in, Shift+F11 step out, Shift+F5 stop

#### US-018: Call stack panel
**Description:** As a user, I want to see the call stack when paused so I can understand how my code got to the current line.

**Acceptance Criteria:**
- [ ] New dockable panel "Call Stack" that shows frames from `dbstack`
- [ ] Each frame shows: function name, file, line
- [ ] Clicking a frame navigates the editor to that file/line
- [ ] Panel auto-updates on each step/continue/pause

#### US-019: Variables at current scope shown in Workspace panel
**Description:** As a user, when paused, I want the Workspace panel to show variables of the current stack frame (not just the top scope).

**Acceptance Criteria:**
- [ ] While paused, Workspace panel queries `whos` in current frame context
- [ ] Variable values reflect the paused-scope values
- [ ] Resumes showing top scope once debugging ends

#### US-020: Pause running execution (Ctrl+C equivalent for debugger)
**Description:** As a user, I want to interrupt a running script and drop into the debugger at the current line.

**Acceptance Criteria:**
- [ ] "Pause" button in toolbar while script is running
- [ ] Sends SIGINT + `dbstop` at the line Octave was executing
- [ ] UI transitions to debug mode showing the current line

#### US-021: Conditional breakpoints
**Description:** As a user, I want breakpoints that only trigger when a condition is true.

**Acceptance Criteria:**
- [ ] Right-click on breakpoint → "Edit condition"
- [ ] Dialog accepts an expression, e.g. `i > 10`
- [ ] Translates to `dbstop in "file.m" at LINE if "i > 10"`
- [ ] Conditional breakpoints render with a different color/shape

#### US-022: Watch expressions panel
**Description:** As a user, I want a panel where I can pin arbitrary expressions and see their values update as I step.

**Acceptance Criteria:**
- [ ] New panel "Watches"
- [ ] User can add expressions; each row shows `expression = value`
- [ ] Values update on every pause/step via `disp(expression)` queries
- [ ] Remove/edit watches via row controls

#### US-023: Edit-and-continue (best effort)
**Description:** As a user, I want to edit my code while paused and continue execution with the change.

**Acceptance Criteria:**
- [ ] On file save while paused: re-apply breakpoints, continue from current line if possible
- [ ] Document limitations clearly: Octave doesn't natively support true edit-and-continue; we approximate by re-running from the current function entry
- [ ] Warning banner: "Changes will take effect when this function is re-entered"

---

### Phase 5 — Dockable Panels

#### US-024: Evaluate and integrate rc-dock
**Description:** As a developer, I need to choose a React dock layout library and set it up in the codebase.

**Acceptance Criteria:**
- [ ] Write an ADR comparing `rc-dock`, `flexlayout-react`, `dockview`
- [ ] Recommendation: rc-dock (MIT, active maintenance, MATLAB-like feel)
- [ ] Add dependency
- [ ] Create a minimal `<DockLayout>` wrapping existing panels as dock panes

#### US-025: Migrate all panels to dock panes
**Description:** As a user, I want every panel (Editor, Command Window, File Browser, Workspace, Figure, Call Stack, Watches, History) to be a dock pane I can rearrange.

**Acceptance Criteria:**
- [ ] Each panel is a dock pane with a tab header
- [ ] Default layout matches Phase 1 design
- [ ] Allotment dependency removed
- [ ] All existing E2E tests still pass (test IDs preserved)

#### US-026: Drag tabs between docks
**Description:** As a user, I want to drag a panel's tab to another dock location (left/right/top/bottom/tab-merge).

**Acceptance Criteria:**
- [ ] Dragging a tab shows drop indicators
- [ ] Dropping merges the panel into the target dock
- [ ] Layout persists via existing layout IPC
- [ ] Playwright test: drag Workspace tab next to Command Window, assert new position

#### US-027: Detach panel to separate OS window
**Description:** As a user, I want to double-click or right-click a panel tab to pop it out into its own Electron window.

**Acceptance Criteria:**
- [ ] "Detach" option in tab context menu
- [ ] New `BrowserWindow` opens containing just that panel
- [ ] Panel remains functional (shares Octave state via IPC)
- [ ] Closing the detached window redocks to the previous location

#### US-028: Layout presets
**Description:** As a user, I want to save the current layout as a preset and switch between presets.

**Acceptance Criteria:**
- [ ] View → Layouts menu with: Default, Debugger, Two-Column, Code-Only
- [ ] "Save Current as Preset..." prompts for a name
- [ ] Custom presets persist and appear in the menu
- [ ] "Reset Layout" returns to Default preset

---

### Phase 6 — Smaller MATLAB Features

#### US-029: Code sections (`%%`) in .m files with run-section button
**Description:** As a user, I want to split a regular `.m` script into sections with `%%` and run just the current section.

**Acceptance Criteria:**
- [ ] Monaco highlights `%%` section breaks with a divider
- [ ] "Run Section" button and Ctrl+Enter shortcut runs only the section at cursor
- [ ] "Run and Advance" moves cursor to next section

#### US-030: Publish to HTML
**Description:** As a user, I want to export a `.m` or `.mls` file with its outputs rendered to a shareable HTML document.

**Acceptance Criteria:**
- [ ] File → Publish → HTML... generates a static HTML file with code, text output, and embedded images
- [ ] Live scripts preserve cell layout
- [ ] Syntax highlighting in output
- [ ] No JS required in output (for portability)

#### US-031: Help browser (doc command)
**Description:** As a user, I want to type `doc sin` in the command window and see rendered documentation.

**Acceptance Criteria:**
- [ ] `doc <name>` opens a Help panel (new dock pane)
- [ ] Panel shows Octave's help text for the function, rendered with basic formatting
- [ ] Clickable cross-references (`See also: cos, tan`) navigate the help panel

#### US-032: Find in Files
**Description:** As a user, I want to search for a string across all files in the current directory.

**Acceptance Criteria:**
- [ ] Ctrl+Shift+F opens Find-in-Files panel
- [ ] Input for search string, optional glob pattern for file filter
- [ ] Results list shows file + line + context
- [ ] Clicking a result opens the file at that line

#### US-033: Profiler integration
**Description:** As a user, I want to profile my script's execution to find bottlenecks.

**Acceptance Criteria:**
- [ ] Profiler panel with "Start", "Stop", "Report" buttons
- [ ] "Start" sends `profile on`; "Stop" sends `profile off`
- [ ] "Report" parses `profile('info')` output and shows function × time table
- [ ] Clicking a function navigates to its definition

#### US-034: Session save/restore
**Description:** As a user, I want the app to reopen my last session (open tabs, cursor positions, layout) on launch.

**Acceptance Criteria:**
- [ ] On quit, serialize open tabs + active tab + cursor + layout to `session.json`
- [ ] On launch, restore if session file exists
- [ ] Preference to disable session restore
- [ ] Unsaved changes are saved to a recovery file, not lost

#### US-035: Keyboard shortcut editor
**Description:** As a user, I want to customize keyboard shortcuts via a settings UI.

**Acceptance Criteria:**
- [ ] Preferences → Keyboard tab shows all commands with current bindings
- [ ] Click a binding → "Press a key combination..." capture
- [ ] Conflicts flagged
- [ ] Customizations persist

#### US-036: Variable editor polish
**Description:** As a user, I want to edit arrays and matrices in a spreadsheet-like grid.

**Acceptance Criteria:**
- [ ] Double-click a variable in Workspace opens an inline grid editor (not just a dialog)
- [ ] Edits update Octave via `assign`
- [ ] Supports 2D matrices; 3D+ shows slice selector
- [ ] Undo stack per variable

#### US-037: Git integration (status + diff + commit)
**Description:** As a user, I want to see git status in the file browser and commit from within the IDE.

**Acceptance Criteria:**
- [ ] File browser shows git status badges (M/A/?) on files
- [ ] New Source Control panel with staged/unstaged lists
- [ ] Click a file → diff viewer
- [ ] Commit button with message field
- [ ] Uses system `git` binary via child_process

---

### Phase 7 — Cross-Platform Packaging

#### US-038: Extend download-octave.js for macOS
**Description:** As a developer, I need the pre-build script to download Octave for macOS so we can bundle it.

**Acceptance Criteria:**
- [ ] Script downloads Octave.app for macOS (universal or per-arch)
- [ ] Extracts to `resources/octave/` with mac-specific layout
- [ ] `getBundledOctavePath` in `octaveConfig.ts` handles mac paths
- [ ] `build:mac` includes the Octave bundle

#### US-039: Extend download-octave.js for Linux
**Description:** As a developer, I need the pre-build script to download or build Octave for Linux for bundling.

**Acceptance Criteria:**
- [ ] Script downloads a Linux Octave distribution (AppImage or tarball)
- [ ] Extracts to `resources/octave/` with linux layout
- [ ] `getBundledOctavePath` handles linux paths
- [ ] `build:linux` includes the Octave bundle

#### US-040: Windows code signing
**Description:** As a user, I want the Windows installer to be signed so Windows SmartScreen doesn't warn me.

**Acceptance Criteria:**
- [ ] Electron-builder configured to sign with a provided cert (env-var credentials)
- [ ] Build docs explain how to supply signing cert
- [ ] CI signs automatically if cert env vars are set
- [ ] Unsigned fallback still works for local dev

#### US-041: Auto-update channel
**Description:** As a user, I want the app to offer updates when a new version is available.

**Acceptance Criteria:**
- [ ] `electron-updater` integrated
- [ ] Update check on launch, configurable interval
- [ ] Notification banner offers "Install now" / "Later"
- [ ] Update server points to GitHub Releases (free, simple)

#### US-042: macOS notarization
**Description:** As a macOS user, I want the app to be notarized so it opens without Gatekeeper warnings.

**Acceptance Criteria:**
- [ ] Notarization step added to `build:mac` via electron-builder
- [ ] Docs explain Apple Developer ID setup
- [ ] Skipped gracefully if credentials missing

---

## Functional Requirements

### Phase 1
- FR-1: The main window uses a nested Allotment tree where the center column splits vertically into Editor (top) and Command Window (bottom); neither extends under the File Browser or Workspace columns.
- FR-2: Dragging a cell's grip handle over another cell's drop zone reorders the cells in state and persists on save.
- FR-3: On first launch with no stored layout, the app applies a MATLAB-default layout preset.
- FR-4: View menu has a "Reset Layout" item that restores the default preset.

### Phase 2
- FR-5: Live script cells render within a top-level CSS grid: `grid-template-columns: 1fr 1fr`.
- FR-6: Code and output for the same cell share the same `grid-row`.
- FR-7: Vertical scroll is managed at the grid container, not per-cell.
- FR-8: Cell controls (run, drag, delete) are attached to the code column and move with their code.

### Phase 3
- FR-9: `matslop_export_fig(h)` emits a JSON object describing all children of figure `h` including plot type, data arrays, axes properties, view angles, and labels.
- FR-10: `PlotRenderer` accepts the JSON and renders using Plotly.js.
- FR-11: Mouse drag rotates 3D plots; scroll wheel zooms; Shift+drag pans.
- FR-12: Data cursor mode shows coordinates on click.
- FR-13: Export button saves the current view to PNG or SVG.
- FR-14: Detached plot window opens in a separate `BrowserWindow` with the same `PlotRenderer` component.
- FR-15: If figure serialization fails, fall back to static PNG with a warning.

### Phase 4
- FR-16: Clicking the editor gutter toggles a breakpoint on that line.
- FR-17: Setting a breakpoint issues `dbstop in "<abs path>" at <line>` to Octave.
- FR-18: Parsing `stopped in <file> at line <N>` in stderr transitions the UI into debug mode.
- FR-19: Debug toolbar buttons send `dbcont`, `dbstep`, `dbstep in`, `dbstep out`, `dbquit` respectively.
- FR-20: Pause button sends SIGINT then `dbstop` at the current executing line.
- FR-21: Call stack panel queries `dbstack` and renders frames; clicking a frame opens that file/line in the editor.
- FR-22: Workspace panel queries variables in the current debug frame via Octave's `evalin('caller', 'whos')` or equivalent.
- FR-23: Right-click breakpoint → "Edit condition" issues `dbstop in "<file>" at <line> if "<expr>"`.
- FR-24: Watch expressions panel evaluates each expression via `disp(expr)` on every pause event.
- FR-25: Saving a file while paused re-applies breakpoints and shows a "Changes take effect when re-entered" banner.

### Phase 5
- FR-26: All UI panels are rendered as rc-dock `DockPanel` nodes.
- FR-27: Dragging a tab to another dock region merges/splits as indicated by drop hints.
- FR-28: Tab context menu has a "Detach" item that opens a new `BrowserWindow`.
- FR-29: Detached windows share IPC state with the main window (same Octave instance).
- FR-30: View → Layouts menu lists built-in and user-saved layout presets.
- FR-31: "Save Current as Preset..." opens a name-input dialog and persists to user data.

### Phase 6
- FR-32: `%%` comments in `.m` files render as section dividers in Monaco.
- FR-33: Ctrl+Enter runs the section containing the cursor (identified by `%%` boundaries).
- FR-34: Publish menu item generates a self-contained HTML file with code, text output, and inline base64 images.
- FR-35: `doc <name>` opens a Help dock pane showing the function's help text.
- FR-36: Ctrl+Shift+F opens Find-in-Files with search input, glob filter, and results list.
- FR-37: Profiler panel wraps `profile on/off/info` with Start/Stop/Report buttons.
- FR-38: Session state (open tabs, cursors, layout) is saved on quit and restored on launch.
- FR-39: Keyboard shortcut editor in Preferences lists all commands and accepts new bindings.
- FR-40: Variable editor provides an inline grid for 2D matrices with direct-edit cells.
- FR-41: File browser displays git status badges; Source Control panel shows staged/unstaged files and supports commit.

### Phase 7
- FR-42: `scripts/download-octave.js` supports `--platform=darwin` downloading Octave.app.
- FR-43: `scripts/download-octave.js` supports `--platform=linux` downloading a Linux Octave bundle.
- FR-44: `octaveConfig.ts` resolves bundled Octave paths for all three platforms.
- FR-45: `build:mac` and `build:linux` npm scripts produce working installers with bundled Octave.
- FR-46: Windows code signing is configured via environment variables.
- FR-47: macOS notarization is configured when Apple Developer ID credentials are present.
- FR-48: `electron-updater` is integrated with GitHub Releases as the update server.

## Design Considerations

- **Dark theme first.** The current VS-Code-like dark theme is well-received; light theme is secondary.
- **Familiar iconography.** Use Lucide icons consistently; match MATLAB's symbol conventions where possible (e.g., green arrow for run, red square for stop, blue bug for debug).
- **Monaco Editor** remains the editor primitive for `.m` files and code cells in `.mls`.
- **Plotly.js** chosen for plotting over Three.js because it provides 2D and 3D out-of-the-box, matches MATLAB plot types well, and has a higher-level API that maps naturally to our JSON schema.
- **rc-dock** chosen for panel management because it's actively maintained, MIT licensed, supports drag-drop and detach-to-window, and has TypeScript types.
- **Bundle size budget.** Before Phase 3, document current bundle size. Plotly will add ~3MB; acceptable.
- **Performance target.** Interactive plot rotation should maintain 30 FPS on a mid-range laptop for typical plots (< 10k data points).
- **Accessibility.** Ensure all dock actions and debugger controls are keyboard-accessible.

## Technical Considerations

- **Octave stays the computational authority.** No client-side math, no custom parser. All features defer execution semantics to Octave.
- **IPC surface grows significantly.** Keep IPC handlers organized by feature in `src/main/ipc/<feature>.ts` modules as the surface grows beyond a single `index.ts`.
- **Plot data extraction is the trickiest Phase 3 task.** The `matslop_export_fig` Octave function must handle edge cases (empty axes, NaN data, log scales, colormap customization). Start with a narrow set of plot types and expand.
- **Debugger state machine.** The main process must track "running" vs "paused" vs "idle" and gate IPC commands accordingly. Model it explicitly in `octaveProcess.ts` with a `DebugSession` helper.
- **Bundled Octave for macOS/Linux** may require license compliance checks (GPL). Document license attribution in About dialog.
- **rc-dock migration requires preserving all `data-testid` attributes** so existing 34 E2E tests keep passing. Add a pre-migration task to audit and pin test IDs.
- **Test discipline**: every user story must land with at least one corresponding test (unit, integration, or E2E). The current bar is 83 tests; each phase should raise that proportionally.
- **Hot reload limitations.** Main-process changes require a full Electron restart. The debugger work (which is mostly main-process) will be slow to iterate; consider a lightweight main-process test harness.

## Success Metrics

- **Functional parity score.** Track a checklist of MATLAB IDE features; target ≥ 80% coverage by end of Phase 6.
- **Time-to-first-plot.** New user downloads installer → sees a rendered plot in < 60 seconds.
- **Debugger usability.** Users can set a breakpoint, hit it, step three lines, and inspect a variable in < 10 seconds.
- **Interactive plot FPS.** 3D rotation maintains ≥ 30 FPS on 10k-point plots on a mid-range laptop.
- **Test suite.** Passes continuously throughout each phase; never ship a phase with failing tests.
- **Installer size.** Windows installer ≤ 1.2 GB (current bundled Octave is the dominant cost).
- **Zero setup.** 100% of new users reach a working Octave prompt without configuration.

## Open Questions

- **JS plotting library verdict:** is Plotly.js's bundle size (+3MB gzip) acceptable, or should we pursue a lighter path with Three.js + a custom adapter (more dev effort, smaller runtime)?
- **Octave-side plot export implementation:** is `hgsave` to `.ofig` a better intermediate than custom JSON? `.ofig` is binary and not directly parseable, so probably not — but worth confirming.
- **Debugger call stack depth:** how deep should we show frames? MATLAB shows unlimited; truncate at 100?
- **Detached-window IPC:** should detached panels share the main-window React tree or have their own? Sharing is complex; separate is simpler but requires duplicate state subscription.
- **macOS Octave bundle source:** official `octave.app` is Universal (~1GB). Is there a smaller arch-specific path?
- **Session restore conflicts with unsaved changes:** if a user force-quits with unsaved `untitled-5.m`, do we restore as "untitled-5 (recovered)" or discard? Recovery file strategy needs a decision.
- **Edit-and-continue feasibility:** Octave's debugger semantics don't cleanly support edit-and-continue. Is "best effort" (re-enter current function) acceptable, or should we cut this feature?
- **Git integration scope:** is a full source control panel in scope, or is "status badges only" enough for v1?
- **MATLAB visual fidelity:** should we reverse-engineer MATLAB's exact color palette and fonts, or maintain our own VS-Code-adjacent aesthetic?
- **User feedback loop:** once Phases 1-3 ship, should we open a GitHub Discussions or similar to collect priorities for Phase 6's ordering?

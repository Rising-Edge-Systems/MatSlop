# PRD: MatSlop — Look-and-Feel Polish Pass

## Introduction

After the 42-story roadmap landed, a hands-on visual inspection of the running
app (Electron dev build, 1854x1000 window) surfaced a cluster of layout,
theming, and UX bugs that make MatSlop look unfinished. This PRD captures the
fixes. The symptoms are mostly cosmetic but severe — large gray voids between
panels, a forced light theme that ignores the project's dark theme variables,
duplicate panel headers, and a mandatory Octave-setup modal on every launch.

Two screenshots are the reference for every story in this PRD:

- `/tmp/matslop-05.png` — default 1400x900 window, Octave modal dismissed
- `/tmp/matslop-06.png` — resized to 1854x1000, showing how the gaps grow

The root causes are narrow and well-understood; this is a polish pass, not a
rearchitecture.

## Goals

- Make MatSlop visually indistinguishable from a finished IDE at first launch.
- Every dock panel fills its allotted area — no empty gray voids.
- A single header per panel (rc-dock's tab header — no duplicate legacy bar).
- Dark theme renders consistently across the whole window, including rc-dock.
- First-launch onboarding does not block the user from seeing the UI.
- No regression of the 200+ existing unit/E2E tests.

## Non-Goals

- No new panels, features, or menu items.
- No redesign of plot rendering, debugger, or any roadmap feature.
- No replacement of rc-dock or Monaco.
- No change to IPC surface or persisted layout schema.
- No light-theme tuning beyond "it still works" — dark is the target.

## Root-Cause Findings (from inspection)

1. **Duplicate panel headers.** Every pane (`FileBrowser.tsx`,
   `EditorPanel.tsx`, `WorkspacePanel.tsx`, `CommandWindow.tsx`, etc.) still
   renders its own `<PanelHeader>` inside the dock content, on top of
   rc-dock's own tab header. US-025 migrated the panels into rc-dock but
   never deleted the legacy headers. Result: two stacked headers per pane,
   each with its own close button — and the inner close button can delete
   panels that rc-dock has no way to restore.

2. **Panels collapse to intrinsic size.** `MatslopDockLayout.tsx:441` wraps
   every loaded tab in
   `<div style={{ width: '100%', height: '100%', display: 'flex',
   overflow: 'hidden' }}>`. The child (`.panel`) has `height: 100%` in
   `styles.css:302` but no `width: 100%` and no `flex: 1`. Inside a
   `display: flex` (row by default) parent, the child shrinks to its
   content width. That is why the File Browser / Editor / Workspace /
   Command Window are tiny boxes pinned to the top-left of their pane with
   huge empty space to the right and below.

3. **rc-dock light theme leaks through.** `MatslopDockLayout.tsx:10` imports
   `rc-dock/dist/rc-dock.css` (the light theme). The project ships a dark
   theme via CSS variables in `styles.css:2`, but rc-dock's base CSS sets
   its own backgrounds/borders that override the variables inside the dock
   tree. Only elements outside rc-dock (status bar, menu bar) pick up the
   dark theme — everything in between renders light.

4. **"GNU Octave Not Found" modal blocks the first-run UI.** The modal
   covers the center of the window on every launch until the user supplies
   a path. It should be non-blocking (banner) so users can see the IDE and
   dismiss it later.

5. **Initial window is 1400x900, not maximized.** The app opens in a small
   centered window that doesn't match the way most IDEs ship. A larger
   default (or honoring `screen.getPrimaryDisplay().workAreaSize`) would
   feel more finished.

6. **"Command History" ghost tab floats above Command Window.** Visible in
   `matslop-06.png` at ~(150, 320). A tab handle is rendering disconnected
   from any dock panel — likely a stale dock node for a panel whose
   visibility is false but whose tab id still appears in a saved layout
   tree.

7. **Editor column is narrow even at 1854px.** Code text is cropped
   (`% Welcome to Ma`, `disp("Hello`) because the editor content pane
   cannot grow past the collapsed `.panel` width. Downstream of issue #2.

8. **PanelHeader close button is destructive.** Clicking the X on e.g.
   "File Browser" removes the pane from the dock tree with no undo and no
   menu path to bring it back except restarting. Partly downstream of
   issue #1 — removing the legacy header also removes this footgun.

## User Stories

### US-P01: Remove legacy `<PanelHeader>` from every dock-hosted panel
**Description:** As a user, I want exactly one header per dock pane (the
rc-dock tab header), not two.

**Acceptance Criteria:**
- [ ] `PanelHeader` import/usage removed from every panel that ships inside
      `MatslopDockLayout`: `FileBrowser`, `EditorPanel`, `WorkspacePanel`,
      `CommandWindow`, `CommandHistoryPanel`, `CallStackPanel`,
      `WatchesPanel`, `FigurePanel`, `HelpPanel`, `FindInFilesPanel`,
      `ProfilerPanel`, `SourceControlPanel`
- [ ] `PanelHeader.tsx` kept only if something outside the dock still needs
      it (e.g., `DetachedPanel`); otherwise delete it
- [ ] The pane still has its title in rc-dock's tab strip (already wired in
      `MatslopDockLayout.tsx:429` via `DOCK_TAB_TITLES`)
- [ ] Playwright smoke: only one element with a panel title per pane
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P02: Fix dock tab content sizing so panels fill their pane
**Description:** As a user, I want every panel to fill the full area of the
dock pane it lives in, not collapse to intrinsic content size.

**Acceptance Criteria:**
- [ ] In `MatslopDockLayout.tsx:441`, the tab-content wrapper no longer uses
      `display: flex` without child flex: either drop the flex wrapper, or
      give the child `flex: 1 1 auto; min-width: 0; min-height: 0`
- [ ] `.panel` in `styles.css:302` gets `width: 100%` alongside
      `height: 100%`
- [ ] At any window size, resizing the window causes `.panel` children
      (file tree, monaco editor, workspace table, command window scroller)
      to stretch to fill their pane — no gray void on the right or bottom
      of any pane
- [ ] Playwright: assert `dock-tab-matslop-file-browser` bounding box equals
      its parent `dock-panel` bounding box within 2px on all four sides
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P03: Replace rc-dock light CSS with dark theme
**Description:** As a user, I want the dock panels to match the project's
dark theme instead of rendering with rc-dock's default light chrome.

**Acceptance Criteria:**
- [ ] Import changed from `rc-dock/dist/rc-dock.css` to
      `rc-dock/dist/rc-dock-dark.css`, OR an overrides stylesheet
      (`src/renderer/rc-dock-theme.css`) maps every rc-dock selector
      (`.dock-tab`, `.dock-panel`, `.dock-bar`, `.dock-nav-wrap`,
      `.dock-divider`, `.dock-drop-indicator`) to the project CSS variables
      (`--bg-panel`, `--bg-header`, `--border-color`, `--text-primary`,
      `--accent-color`)
- [ ] Dark theme is the visible default at first launch
- [ ] Switching to light theme via existing `data-theme="light"` switch
      still works (dark overrides scoped accordingly)
- [ ] Playwright: screenshot of the main window has no white/#f3f3f3
      pixels in the dock area when the app is in dark mode
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P04: Make "Octave Not Found" non-blocking (banner, not modal)
**Description:** As a first-time user, I want to see the MatSlop UI on
launch even if Octave isn't detected yet.

**Acceptance Criteria:**
- [ ] On launch, if Octave auto-detect fails, the app still mounts the full
      dock layout and shows a dismissible warning banner above the status
      bar with: a short message, a "Browse for octave-cli..." button, and
      a "Dismiss" button
- [ ] The previous modal dialog component is removed OR only triggered
      explicitly from Preferences → Octave path
- [ ] Banner dismissal persists for the session; on next launch with still
      no Octave, the banner reappears
- [ ] Running any Octave-dependent command while no path is set shows an
      inline error in the Command Window, not a modal
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P05: Maximize (or honor work-area size) at first launch
**Description:** As a user, I want MatSlop to open at a reasonable size on
first launch — not a small centered box leaving most of my display empty.

**Acceptance Criteria:**
- [ ] `BrowserWindow` creation in `src/main/index.ts` uses
      `screen.getPrimaryDisplay().workAreaSize` as the default width/height
      (capped to e.g. 1920x1200 for sanity), OR calls `win.maximize()`
      before first show
- [ ] User-resized dimensions still persist across launches via the
      existing layout/session persistence (no regression to US-030's
      window-state code)
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P06: Remove stale "Command History" ghost tab
**Description:** As a user, I don't want a disconnected "Command History"
tab floating over the Command Window when Command History is not visible.

**Acceptance Criteria:**
- [ ] `buildDockLayoutFromVisibility` in `MatslopDockLayout.tsx` no longer
      emits a Command History tab entry unless `visibility.commandHistory`
      is true (currently it seems to leak in via `activeId` or via saved
      layout rehydration)
- [ ] If the bug is in saved-layout rehydration (US-026 path), drop unknown
      or hidden tab ids from the loaded `LayoutBase` before passing it to
      rc-dock
- [ ] Playwright: launching with default visibility shows zero elements
      with `data-testid="dock-tab-matslop-command-history"`
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P07: Initial dock sizes use flex weights, not fixed pixels
**Description:** As a user, I want the three-column dock to split
proportionally as the window resizes, not cling to fixed pixel sizes that
leave empty space.

**Acceptance Criteria:**
- [ ] In `buildDockLayoutFromVisibility`, the column `size` fields are
      chosen so rc-dock's layout algorithm distributes leftover space to
      the editor column (rc-dock treats `size` as a flex weight; the
      current 220/900/280 triple already sums to 1400 which is the old
      default width — update to weights that reflect proportions rather
      than hardcoded pixels, or explicitly set `minSize` so the center
      column absorbs extra width)
- [ ] At 1920x1080, File Browser is ~15%, Editor+Command ~65%, Workspace
      column ~20%, with no unused space
- [ ] Resizing the window shrinks/grows the center column proportionally
- [ ] Existing "reset layout" preset still places panels in the Phase 1
      positions
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P08: Audit every `.panel` child for `width: 100%; height: 100%`
**Description:** As a developer, I need every panel's root element to
propagate full width and height down to its content (Monaco editor, file
tree container, xterm.js, ag-grid, etc.) so no child sub-component collapses
independently.

**Acceptance Criteria:**
- [ ] All panel root elements (and their direct `.panel-content` children)
      set `width: 100%; height: 100%; min-width: 0; min-height: 0`
- [ ] `EditorPanel` Monaco wrapper explicitly sizes to 100%/100% so Monaco
      auto-layout fills the pane
- [ ] `CommandWindow` xterm element fills its pane (existing `FitAddon`
      call still triggered on resize)
- [ ] `WorkspacePanel` grid fills its pane horizontally
- [ ] Playwright screenshot at 1920x1080: no gray `#252526`-over-nothing
      rectangles larger than 4px inside any dock pane
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P09: Style pass on rc-dock tab strips to match theme
**Description:** As a user, I want the dock tab strips to use the project's
accent color and typography, not rc-dock defaults.

**Acceptance Criteria:**
- [ ] Active tab underline uses `--accent-color` (#007acc)
- [ ] Tab font, size, padding match the existing status bar (12px,
      system UI font)
- [ ] Inactive tabs use `--text-secondary`; active tab uses `--text-bright`
- [ ] Hover state uses `--bg-hover`
- [ ] Close-tab X inside dock-bar tabs still works (only the legacy
      per-panel inner X is removed in US-P01)
- [ ] Any leftover checkbox-looking glyph next to the tab title (visible
      in screenshots, probably from legacy visibility toggles bleeding into
      the tab title node) is removed
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-P10: Regression gate — full-viewport screenshot diff
**Description:** As a maintainer, I want a Playwright test that renders the
default layout at a known viewport and fails if anything regresses visually.

**Acceptance Criteria:**
- [ ] New Playwright spec `tests/e2e/visual-polish.spec.ts`:
      - Launch app at 1600x1000
      - Wait for dock layout idle
      - Take `fullPage: true` screenshot
      - Assert via pixel-count check: no contiguous `#f3f3f3` or
        `#ffffff` region larger than 100x100 inside the dock area (rough
        proxy for "empty void" and "light theme leak")
      - Assert every `data-testid^="dock-tab-"` element has bounding box
        equal to its parent panel content area
- [ ] Baseline screenshot committed to repo
- [ ] Test runs in CI
- [ ] Typecheck passes
- [ ] Tests pass

## Functional Requirements

- FR-P1: Every panel hosted inside rc-dock renders exactly one title bar
  (rc-dock's tab header). No panel renders its own `<PanelHeader>`.
- FR-P2: Every dock tab content element has `width: 100%; height: 100%` and
  fills its rc-dock pane with no whitespace.
- FR-P3: The rc-dock CSS import is the dark theme (or a project override
  stylesheet explicitly themes every rc-dock selector).
- FR-P4: On launch with no detected Octave, the app mounts normally and
  shows a dismissible warning banner instead of a modal.
- FR-P5: `BrowserWindow` default size is the primary display work-area size
  (or maximized), subject to persisted user preference.
- FR-P6: `buildDockLayoutFromVisibility` never emits a tab entry for a
  visibility flag that is false; saved layouts are filtered on hydrate.
- FR-P7: Column sizes in the default layout are proportional weights, not
  hardcoded-to-current-window pixel counts.
- FR-P8: All `.panel` descendants set `min-width: 0; min-height: 0` so
  flex/grid layouts can shrink below intrinsic content size.
- FR-P9: rc-dock tab strips use project theme variables for colors,
  typography, and hover states.
- FR-P10: A visual-regression Playwright spec guards against re-regression.

## Technical Considerations

- **PanelHeader deletion surface area.** Every panel file imports
  `PanelHeader` and renders it at the top. The removal is mechanical but
  large (≈12 files). Keep the component file around if `DetachedPanel`
  (which hosts a panel outside rc-dock) still needs its own header.

- **`min-width: 0` hazard.** Flex children default to `min-width: auto`
  (intrinsic). Setting `min-width: 0` lets children shrink but can clip
  content that expected to overflow horizontally. Test the Command Window
  (xterm) and Workspace grid carefully.

- **rc-dock theme override scope.** If importing `rc-dock-dark.css`
  directly works, prefer it. If it pulls in too much and conflicts with
  project variables, ship a custom `rc-dock-theme.css` that targets only
  the rc-dock class selectors and reads from `var(--...)`.

- **Saved-layout hydration (US-026).** Users who already launched the app
  and persisted a layout may have stored tab ids for panels whose
  visibility is now false. The hydration path must strip those before
  passing the layout to rc-dock, otherwise the ghost tab comes back.

- **BrowserWindow sizing and tests.** E2E tests set their own viewport via
  Playwright; the default-size change only affects non-test launches.
  Guard the code path so `process.env.E2E` keeps the existing fixed
  dimensions if tests depend on them.

- **Order of application.** US-P01, US-P02, US-P03 should land in that
  order — fixing sizing (P02) before the theme (P03) avoids churn on
  visual snapshots. US-P10 is last so its baseline captures the polished
  state.

## Success Metrics

- Zero dock-area pixels match `#f3f3f3` or `#ffffff` in the default dark
  theme screenshot.
- Zero panels have duplicate headers.
- Full-viewport screenshot at 1600x1000 shows the file browser, editor,
  workspace, and command window each filling their pane with no void.
- First-launch flow shows the full IDE immediately; Octave banner is
  non-blocking.
- All existing unit/E2E tests still pass; new visual-polish spec passes.

# ADR 0002: React dock layout library — rc-dock vs. flexlayout-react vs. dockview

* **Status:** Accepted
* **Date:** 2026-04-11
* **Owners:** MatSlop team
* **Supersedes:** none
* **Related:** US-024 (evaluate and integrate rc-dock), US-025 (migrate all panels to dock panes), US-026 (drag tabs between docks), US-027 (detach panel to separate OS window), US-028 (layout presets)

## Context

Up through US-023, MatSlop's main window uses `allotment` (a thin
split-pane library) to arrange the File Browser, Editor, Command Window,
Workspace, Call Stack, Watches and Figure panels. `allotment` does a
good job of fixed column/row splits with live resizing and it has
carried us this far, but the MATLAB-parity roadmap (US-024 through
US-028) now needs capabilities `allotment` does not have:

* **Tabs inside a pane** — e.g. the Editor pane needs multiple file
  tabs that can be reordered and moved between splits.
* **Drag a tab from one dock region to another** — e.g. tear
  the Workspace out of the right column and drop it next to the
  Editor (US-026).
* **Detach a tab into a separate OS window** — the Figure window
  should be floatable / windowable, which is how MATLAB's docked
  figures behave (US-027).
* **Serialize an arbitrary layout to JSON and re-load it** — needed
  for layout presets and session restore (US-028, US-034).

We evaluated three React libraries that each claim to cover this space:
`rc-dock`, `flexlayout-react`, and `dockview`. This ADR records the
comparison and the choice.

## Options considered

### Option A — rc-dock

* **What it is:** A React dock layout library modeled after
  JetBrains / VS Code dock panes. Written in TypeScript, MIT licensed,
  actively maintained (releases within the last 30 days), ~9 KLOC.
  NPM: `rc-dock`.
* **API shape:** A single `<DockLayout>` component takes a
  `defaultLayout: LayoutData` describing a tree of `BoxData` (horizontal
  or vertical splits) with `PanelData` leaves containing `TabData`
  entries. Tabs render either a `React.ReactElement` directly or via a
  `loadTab(tab)` factory keyed by id — the factory pattern is crucial
  for us because our panels need live refs to parent state (editor
  tabs, engine status, breakpoint stores, …) that cannot be baked into
  a static JSON snapshot.
* **Feature fit:**
  * **Tabs inside a pane:** native.
  * **Drag a tab between panes:** native. Panels opt in by sharing the
    same `group` name (we will use e.g. `'main'` for top-level panels).
  * **Detach / float:** opt-in via `TabGroup.floatable` and
    `TabGroup.newWindow`. `newWindow: true` opens a real `window.open`
    which, inside Electron, is interceptable via `webContents.on(
    'new-window', …)` so we can route the detached tab to a
    `BrowserWindow` we fully control (this is exactly how US-012's
    detached plot window already works — reuse of pattern).
  * **Serialize / restore:** `DockLayout` exposes `saveLayout()` and
    `loadLayout()` that round-trip to a plain JSON `LayoutBase`. IDs in
    the saved layout survive a reload because our `loadTab` factory
    rebuilds the content from ids alone.
* **Styling:** Ships `rc-dock.css` and `rc-dock-dark.css`. Both are
  small (< 15 KB each) and CSS-variable driven, so our theme can
  override colors without forking the library.
* **TypeScript:** First-class (library is authored in TS). No
  `@types/rc-dock` dep needed.
* **Risks / caveats:**
  * Current latest tag is `4.0.0-alpha.2`. The 3.x line is
    production-stable and 4.0 is mostly a React 19 compatibility
    bump. We pin to `^4.0.0-alpha.2` initially but keep the API
    surface small enough that dropping back to 3.x is a
    one-commit revert.
  * The drag handles mount on `body` via a portal — e2e tests that
    assert on DOM structure need to scope selectors explicitly.

### Option B — flexlayout-react

* **What it is:** Caplin's tab-management library for financial
  dashboards. Apache-2.0, actively maintained, TypeScript types
  shipped.
* **Feature fit:** Tabs, splits, drag-between-docks, float windows,
  JSON persistence — all present. Feature-equivalent to rc-dock on
  paper.
* **Why not:**
  * Styling is more invasive: global CSS rules target `.flexlayout__`
    classes with high specificity and the library assumes absolute
    positioning of the whole window. Matching the MATLAB look means
    overriding ~20 CSS classes.
  * The tab-content model is imperative: you provide a single
    `factory(node)` that returns a React element for every tab type,
    keyed by `node.getComponent()`. This works but it scatters the
    panel wiring (ids, groups, factories) across more surface area
    than rc-dock's `loadTab` + `PanelData.tabs[*].id` pattern.
  * Float windows go through `window.open`, same caveat as rc-dock,
    with no additional benefit.

### Option C — dockview

* **What it is:** A newer React dock library with a VS Code-like
  look. MIT, actively maintained, TypeScript.
* **Feature fit:** Tabs, splits, drag-between-docks, panels; JSON
  persistence via `toJSON()` / `fromJSON()`.
* **Why not:**
  * **No native float / detach-to-OS-window.** dockview supports
    "floating groups" inside the same page but does not expose a
    public API for reparenting a panel into a separate `BrowserWindow`.
    US-027 is part of this roadmap and would become significantly
    harder.
  * Bundle size is comparable (~150 KB) but the API surface is larger:
    separate `DockviewReact`, `DockviewApi`, `IDockviewPanelProps`,
    etc. — more to learn for the same feature set.
  * MATLAB's dock feel (tabs on top, thin splitters, flat borders) is
    closer to rc-dock's defaults than dockview's defaults, which
    lean VS Code.

## Decision

**Adopt `rc-dock`.**

rc-dock is the smallest API that covers every dock-layout need in the
roadmap (tabs, drag-between-panes, detach-to-OS-window via Electron's
new-window interception, JSON save/restore), its `loadTab(id)` factory
pattern keeps our panel wiring co-located with the React tree, and its
styling is CSS-variable driven so matching the MATLAB look does not
require forking the library.

## Consequences

### Positive

* US-025 (migrate all panels to dock panes) reduces to "define one
  `loadTab` factory that returns the existing panel component for each
  id, then describe the initial layout as a `LayoutData` tree". No
  panel-side changes needed.
* US-026 (drag tabs between docks) is a free side-effect of sharing a
  single `group` name across the main panels.
* US-027 (detach panel) is "set `floatable: true, newWindow: true` on
  the `figure` / `workspace` groups and reuse the existing
  `plot:getDetachedFigure` Electron BrowserWindow pattern".
* US-028 (layout presets) is a wrapper around `saveLayout()` /
  `loadLayout()` plus a presets menu.
* US-034 (session save/restore) persists the same JSON alongside the
  existing `layoutGet` / `layoutSet` IPC pair.

### Negative / costs

* **New runtime dependency.** `rc-dock@^4.0.0-alpha.2` adds ~140 KB
  minified to the renderer bundle plus its small CSS. This is well
  below the plotly cost (4.7 MB) and is a one-time installer-size
  increase.
* **Alpha tag on 4.x.** We accept the alpha tag because it's the
  React 19 forward-compat line and our renderer targets React 18
  today (which rc-dock 4 still supports). If the alpha proves unstable
  we drop to the last 3.x tag with a one-line `package.json` change;
  the `loadTab`/`LayoutData` API is identical between the two major
  versions.
* **Two layout systems during migration.** US-024 introduces the
  DockLayout side-by-side with the existing `allotment` tree — for one
  iteration only. US-025 deletes the `allotment` main layout.

### Neutral

* `allotment` stays in the dependency list for the duration of US-024
  and is removed in US-025.

## Follow-ups

* US-025: delete the `allotment` main tree in `src/renderer/App.tsx`
  and mount `MatslopDockLayout` at the top level, with each existing
  panel registered via `loadTab(id)`.
* US-026: expose a single `group: 'main'` on all top-level panel
  descriptors so tabs can be reordered freely across docks.
* US-027: set `floatable: true, newWindow: true` on the `figure` /
  `workspace` / `command-history` groups and route the spawned window
  through Electron's `new-window` event into a `BrowserWindow`.
* US-028: add a "View → Layout presets" submenu that calls
  `dockLayoutRef.current.loadLayout(preset)` for each preset.
* US-034: persist the live `saveLayout()` JSON alongside the existing
  panelVisibility/panelSizes in the layout-persistence IPC.

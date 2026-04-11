# PRD: MatSlop — Polish Pass 3

## Introduction

Cycle 2 of the polish pass (ralph/matslop-polish-v2) landed 10 stories on
top of the roadmap branch. A visual inspection after a manual hotfix for
an rc-dock overlay bug (`5f4e08d`) showed the UI is now visible and mostly
functional, but several issues remain. This PRD captures the cycle-3 fixes.

**Reference screenshot:** `/tmp/polish-cdp-03.png` — the app at 1854x982
after the rc-dock overlay hotfix, on branch `ralph/matslop-polish-v2`.

## Goals

- Remove remaining dead space and visual rough edges so the dock feels
  fully "finished" at any window size.
- Land dark theme as the actual visible default at first launch (the
  system honored `prefers-color-scheme: light` in cycle 2 even though the
  project's design baseline is dark).
- Kill the stubborn "Command History" ghost tab that US-P06 failed to
  clear for users with a previously-persisted saved layout.
- Make the active-tab state visually obvious.

## Non-Goals

- No new panels, features, or menu items.
- No changes to the underlying dock library or test infrastructure.
- No semantics changes to layout persistence — only the sanitize step.

## Findings from cycle-2 visual inspection

1. **Dark theme still not the default.** `App.tsx:659-666` resolves the
   stored theme mode; if the stored value is `"system"` (the default on
   fresh profiles) and the OS reports `prefers-color-scheme: light`, the
   app applies `data-theme="light"`. The roadmap PRD called dark theme
   the baseline. Change the unseeded default from `"system"` to `"dark"`
   so first-launch is always dark regardless of OS setting. Users who
   prefer light can still switch in Preferences.

2. **Command History ghost tab still present.** US-P06 added
   `sanitizeSavedDockLayout` but the ghost tab still renders. Most likely
   the sanitizer is not being applied on the load path, or only runs when
   visibility is recomputed. The ghost tab is visible in the cycle-2
   screenshot as "Command History" above the Command Window strip even
   though `DEFAULT_DOCK_VISIBILITY.commandHistory = false`.

3. **Dock voids on panel edges.** In the cycle-2 screenshot you can see
   thin vertical gray strips on the right edge of the File Browser and
   Workspace columns, and dead space beneath the Command Window prompt.
   The `.panel` elements now fill their dock pane, but the *inner*
   content (`.fb-content`, `.cw-output`, `.ws-content`) still leaves
   visible unfilled regions. Either (a) the content containers are
   background-transparent and the dock-panel shows through, or (b) the
   content has a shorter height than its parent.

4. **Tab strip active-state unclear.** Every tab title is underlined
   with the accent color, making it impossible to tell which tab in a
   strip is active. rc-dock's active-tab class is `.dock-tab.dock-tab-active`
   but the US-P09 style sheet targeted `.rc-tabs-tab-active`, which is
   rc-tabs's class (rc-dock wraps rc-tabs but also exposes its own
   `.dock-tab-active`). The ink bar is probably being drawn on every
   tab because the non-active selector isn't suppressing it.

5. **Tab strip gap to the right of the last tab.** After the "File
   Browser" / "Editor" / "Workspace" / "Command Window" tab, the rest
   of the dock-bar is empty gray. rc-dock lets us put a `.dock-nav-wrap`
   filler there, but the theme CSS gave it the same bg as the panel
   header. Fix: let the filler blend into the bar or add a subtle
   separator.

6. **Command Window has no visible toolbar.** Expected but worth noting
   — there's dead space at the top of the Command Window pane where a
   "clear output" / "copy all" toolbar could sit. Cycle 3 will not add
   one; flagged only so it doesn't get blamed on polish.

7. **Workspace column appears to truncate its header text.** "No
   variables in workspace" is partially cut off at the right edge of
   the Workspace pane. Either `.ws-content` has overflow:hidden or the
   column width is too narrow. US-P07 set the column weight to 200
   (20%) which is fine at 1854x982 but may clip at smaller widths.

## User Stories

### US-Q01: Change default theme mode from system to dark
**Description:** As a user, I want the app to open in dark mode by
default even if my OS is set to light mode, matching the project's
design baseline.

**Acceptance Criteria:**
- [ ] `configGetTheme` returns `"dark"` as the seeded default for users
      with no stored preference (update the main-process handler AND
      the React default in `App.tsx:117-118` or wherever the initial
      `themeMode` state is set)
- [ ] First launch with no config sets `data-theme` to nothing (dark)
      instead of `light`, even when OS reports `prefers-color-scheme: light`
- [ ] Users who previously picked light or system still get their
      stored preference on subsequent launches
- [ ] A Playwright test documents the seeded default
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q02: Actually kill the Command History ghost tab for persisted layouts
**Description:** As a user, I never want to see a "Command History" tab
when `commandHistory` visibility is false, even with a persisted layout
that references it.

**Acceptance Criteria:**
- [ ] `sanitizeSavedDockLayout` is applied on BOTH the first-render path
      (`useState` initializer in `MatslopDockLayout.tsx:373-384`) AND on
      any later visibility-driven rebuild that might rehydrate an old
      layout
- [ ] A migration step: if an existing `session.json` or
      `layout.json` contains a tab id whose visibility is currently
      false, strip it on load and write the sanitized layout back
- [ ] Playwright: load a fixture layout that includes
      `matslop-command-history` and assert the rendered DOM has zero
      `[data-testid="dock-tab-matslop-command-history"]` when
      `commandHistory` is false
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q03: Fill panel content to edges (no gray voids inside panes)
**Description:** As a user, I want no visible gray strips or voids inside
any dock pane — the panel content should reach the pane's edges.

**Acceptance Criteria:**
- [ ] File Browser content (`.fb-content`) fills its pane horizontally
      with no gray strip on the right
- [ ] Workspace content (`.ws-content`) fills its pane horizontally
- [ ] Command Window output area (`.cw-output`) fills its pane
      vertically — the prompt `>>` anchors to the bottom with scrollable
      history above it
- [ ] Any `padding` / `margin` on inner containers comes from the theme,
      not from a visible background mismatch
- [ ] Playwright screenshot in dark mode: no contiguous `#252526`
      or lighter rectangle larger than 4x4 inside any dock pane that is
      NOT part of the intended content background
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q04: Distinguish active dock tabs visually
**Description:** As a user, I want to see at a glance which tab in a
dock strip is currently active.

**Acceptance Criteria:**
- [ ] Only the active tab (in rc-dock, `.dock-tab.dock-tab-active`) has
      the accent color underline and bright text
- [ ] Inactive tabs use `--text-secondary` with no underline
- [ ] Hover on an inactive tab uses `--bg-hover` + `--text-primary`
- [ ] Works for both rc-dock's `.dock-tab-active` class AND rc-tabs's
      `.rc-tabs-tab-active` class (the project stylesheet currently
      only targets the latter)
- [ ] Playwright: in a pane with 2+ tabs, assert only one has the
      `dock-tab-active` class AND only one has the inset box-shadow
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q05: Dock bar filler blends into tab strip
**Description:** As a user, I don't want the empty area to the right of
the last tab in a dock bar to look like a disconnected gray box.

**Acceptance Criteria:**
- [ ] The area after the last tab in each dock-bar uses the same
      background as `.dock-bar` (i.e., continues the tab strip visually)
- [ ] If the tab strip wraps or overflows, the rc-tabs overflow
      button (`.rc-tabs-nav-more`) is styled to match the theme
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q06: Workspace column min-width + overflow
**Description:** As a user, I don't want the Workspace pane's header
text ("No variables in workspace") to be truncated when the column is
narrow.

**Acceptance Criteria:**
- [ ] `.ws-content` has `overflow: auto` so long text can scroll
      instead of clipping without indicator
- [ ] Workspace column has a `minSize` in the rc-dock layout so it
      cannot shrink below ~180px
- [ ] Header text wraps or truncates with an ellipsis instead of
      hard-clipping
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q07: Clear stale persisted layout on version bump
**Description:** As a user upgrading from a pre-polish build, I don't
want a stale persisted layout to override the new polished defaults.

**Acceptance Criteria:**
- [ ] The layout persistence file stores a schema `version` field
- [ ] On load, if the stored version is older than the current
      constant, the layout is discarded and the default is applied
      (visibility preferences preserved where possible)
- [ ] Bump the constant by 1 as part of this story
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Verify in browser using dev-browser skill

### US-Q08: Run the existing visual-polish E2E spec as the exit gate
**Description:** As a maintainer, I want `tests/e2e/visual-polish.spec.ts`
(added in US-P10) to actually pass as the exit gate for this polish cycle.

**Acceptance Criteria:**
- [ ] `npm run test:e2e -- visual-polish` passes on the polish-v2 branch
      after the cycle-3 fixes
- [ ] Baseline screenshot updated to match the dark-theme polished state
- [ ] Typecheck passes
- [ ] Tests pass

# PRD: Editor Panel Decomposition & Tab State Refactor

## Introduction

The `EditorPanel.tsx` component (1,098 lines) is a monolithic React component that manages tab lifecycle, session persistence, file I/O, script execution, debugging integration, keyboard shortcuts, drag-and-drop, menu actions, and the welcome tab — all in a single function with 18 state variables, 20+ refs, and 20+ callbacks. This architecture has produced multiple user-facing bugs:

- **Tab ID collisions**: `nextId` counter resets on HMR/reload, causing new tabs to overwrite existing ones (Welcome tab showing instead of new Live Script).
- **Welcome tab cannot close**: `handleCloseWelcome` relied on a `welcomeTabIdRef` that could be stale/null, and `handleTabClose` didn't clear welcome state.
- **Stale closure risks**: Callbacks capture stale tab arrays because refs and state drift apart.
- **Zero component-level tests**: Despite `@testing-library/react` and `jsdom` being installed, no React component tests exist. All UI verification relies on slow E2E Playwright tests.

This refactor decomposes EditorPanel into focused hooks and modules, introduces a `useReducer` for atomic tab state transitions, extracts CSS into scoped files, and adds component-level tests that catch the classes of bugs users keep hitting.

## Goals

- Eliminate tab state bugs by making all tab operations atomic via `useReducer`
- Decompose EditorPanel from 1 monolithic component into focused, testable hooks
- Extract editor-related CSS from the 3,800-line `styles.css` into scoped files
- Add component-level tests using React Testing Library (already installed, unused)
- Ensure all existing unit and E2E tests continue to pass
- Remove the Welcome tab feature entirely (user preference)

## User Stories

### US-R01: Create `useTabReducer` hook with atomic tab operations
**Description:** As a developer, I want all tab state mutations (create, close, select, update content, restore session) to go through a single reducer so state transitions are atomic and testable without React rendering.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useTabReducer.ts` exports a `useTabReducer()` hook
- [ ] Hook returns `[state, dispatch]` where state is `{ tabs: EditorTab[], activeTabId: string | null }`
- [ ] Reducer handles actions: `CREATE_TAB`, `CLOSE_TAB`, `SELECT_TAB`, `UPDATE_CONTENT`, `RESTORE_SESSION`, `UPDATE_SAVED_CONTENT`, `RENAME_TAB`
- [ ] `CREATE_TAB` generates unique IDs using a counter that is synced past any existing IDs (no collision possible)
- [ ] `CLOSE_TAB` automatically selects the adjacent tab (prefer the tab at the same index position, fall back to the last tab)
- [ ] `CLOSE_TAB` skips the unsaved-changes check for non-script tabs (the check is the caller's responsibility — the reducer just removes the tab)
- [ ] `RESTORE_SESSION` sets tabs and activeTabId atomically, and syncs the ID counter past all restored IDs
- [ ] Tab ID generation uses a module-level counter that starts at 1 and increments. `RESTORE_SESSION` advances it past the maximum restored ID.
- [ ] All reducer actions are pure functions (no side effects, no IPC calls)
- [ ] Typecheck passes
- [ ] All existing unit tests pass

### US-R02: Unit test `useTabReducer` with React Testing Library
**Description:** As a developer, I want comprehensive tests for every tab reducer action so regressions like ID collisions and stale active-tab references are caught automatically.

**Acceptance Criteria:**
- [ ] New file `tests/unit/tab-reducer.test.ts` with tests for every action type
- [ ] Test: `CREATE_TAB` generates incrementing unique IDs
- [ ] Test: `CREATE_TAB` after `RESTORE_SESSION` with tabs `[tab-5, tab-3]` produces `tab-6` (not `tab-1`)
- [ ] Test: `CLOSE_TAB` on the active tab selects the next tab (or previous if last)
- [ ] Test: `CLOSE_TAB` on a non-active tab doesn't change activeTabId
- [ ] Test: `CLOSE_TAB` on the only remaining tab sets activeTabId to null
- [ ] Test: `SELECT_TAB` with a valid ID updates activeTabId
- [ ] Test: `SELECT_TAB` with an ID not in tabs is a no-op
- [ ] Test: `UPDATE_CONTENT` updates the correct tab's content without affecting other tabs
- [ ] Test: `RESTORE_SESSION` replaces all tabs and activeTabId atomically
- [ ] Test: `RENAME_TAB` updates filename and filePath for the target tab
- [ ] Test: rapid `CREATE_TAB` calls never produce duplicate IDs
- [ ] Tests use `renderHook` from `@testing-library/react` to test the hook
- [ ] vitest.config.ts updated to use jsdom environment for this test file (or a vitest workspace config)
- [ ] Typecheck passes
- [ ] All tests pass

### US-R03: Extract `useSessionPersistence` hook
**Description:** As a developer, I want session save/restore logic in its own hook so it can be tested independently and doesn't clutter the tab management code.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useSessionPersistence.ts` exports `useSessionPersistence()` hook
- [ ] Hook accepts `{ tabs, activeTabId, tabCursors }` as inputs and handles: restore on mount, debounced save on change (400ms), flush on `beforeunload`
- [ ] Hook returns `{ sessionReady: boolean, restoreEnabled: boolean, tabCursors: Record<string, CursorSnapshot>, updateCursor: (tabId, line, column) => void }`
- [ ] On mount, the hook calls `window.matslop.sessionGet()` and returns restored tabs via a callback (or returns them from the hook)
- [ ] Session restore passes restored tabs through the callback so the parent can dispatch `RESTORE_SESSION`
- [ ] Debounced save calls `window.matslop.sessionSet()` with the current state
- [ ] `beforeunload` flush calls `window.matslop.sessionSet()` synchronously (best-effort)
- [ ] The `tabsToSession` and `sessionToTabs` pure functions from `sessionState.ts` are still used (no duplication)
- [ ] All existing session-state unit tests pass
- [ ] Typecheck passes

### US-R04: Unit test `useSessionPersistence` hook
**Description:** As a developer, I want tests verifying session restore, debounced save, and flush-on-unload behavior work correctly.

**Acceptance Criteria:**
- [ ] New file `tests/unit/session-persistence-hook.test.ts`
- [ ] Test: on mount with restore enabled, calls `sessionGet()` and invokes the restore callback with parsed tabs
- [ ] Test: on mount with restore disabled, does not call `sessionGet()`
- [ ] Test: on mount with corrupt session data, does not crash and invokes callback with null
- [ ] Test: when tabs change, calls `sessionSet()` after 400ms debounce
- [ ] Test: rapid tab changes only trigger one `sessionSet()` call (debounce coalescing)
- [ ] Test: `beforeunload` event triggers immediate `sessionSet()` call
- [ ] IPC calls (`window.matslop.*`) are mocked via `vi.fn()`
- [ ] Typecheck passes
- [ ] All tests pass

### US-R05: Extract `useFileOperations` hook
**Description:** As a developer, I want file open/save/save-as logic in its own hook so EditorPanel doesn't mix file I/O with tab state management.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useFileOperations.ts` exports `useFileOperations()` hook
- [ ] Hook accepts a `dispatch` function (from `useTabReducer`) and handles: `openFile()`, `saveFile(tab)`, `saveFileAs(tab)`, `publishHtml(tab)`
- [ ] `openFile()` shows the file dialog, checks if the file is already open (dispatches `SELECT_TAB` if so), and dispatches `CREATE_TAB` for new files
- [ ] `saveFile(tab)` saves to `tab.filePath` if it exists, otherwise calls `saveFileAs`
- [ ] `saveFile` dispatches `UPDATE_SAVED_CONTENT` after a successful save
- [ ] `saveFileAs(tab)` shows the save dialog, saves, and dispatches `RENAME_TAB` + `UPDATE_SAVED_CONTENT`
- [ ] `publishHtml(tab)` generates HTML via the existing `publishHtml()` function and writes via `publishWriteFile`
- [ ] All IPC calls go through `window.matslop.*` (no new abstractions)
- [ ] Typecheck passes
- [ ] All existing tests pass

### US-R06: Unit test `useFileOperations` hook
**Description:** As a developer, I want tests for file open/save/save-as flows so regressions in file I/O are caught.

**Acceptance Criteria:**
- [ ] New file `tests/unit/file-operations-hook.test.ts`
- [ ] Test: `openFile()` with a new file dispatches `CREATE_TAB` with correct filename, content, filePath, and mode
- [ ] Test: `openFile()` with an already-open file dispatches `SELECT_TAB` (no duplicate tab)
- [ ] Test: `openFile()` when user cancels the dialog does nothing
- [ ] Test: `saveFile()` on a tab with `filePath` calls `window.matslop.saveFile` and dispatches `UPDATE_SAVED_CONTENT`
- [ ] Test: `saveFile()` on an untitled tab (no filePath) delegates to `saveFileAs`
- [ ] Test: `saveFileAs()` when user cancels does nothing
- [ ] Test: `saveFileAs()` on success dispatches `RENAME_TAB` and `UPDATE_SAVED_CONTENT`
- [ ] Test: `.mls` files are opened with mode `'livescript'`, `.m` files with mode `'script'`
- [ ] IPC calls mocked via `vi.fn()`
- [ ] Typecheck passes
- [ ] All tests pass

### US-R07: Extract `useScriptExecution` hook
**Description:** As a developer, I want script run/stop/section-run logic in its own hook so execution concerns are separated from tab management.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useScriptExecution.ts` exports `useScriptExecution()` hook
- [ ] Hook accepts `{ getActiveTab, saveFile, engineStatus }` and exposes: `run()`, `stop()`, `runSection()`, `runAndAdvance()`
- [ ] `run()` auto-saves the active tab before executing (calls `saveFile`), builds the command via `buildRunScriptCommand()`, and calls the `onRun` callback
- [ ] `run()` for untitled tabs writes content to a temp file in the user's home directory, then runs from there
- [ ] `run()` detects function-only files via `isFunctionOnlyFile()` and sets a warning message instead of running
- [ ] `runSection()` uses `findSectionRange()` to extract the code at the cursor, then calls `onRunSection`
- [ ] `runAndAdvance()` calls `runSection()` then moves the cursor via `findNextSectionAdvanceLine()`
- [ ] `stop()` calls the `onStop` callback
- [ ] The hook returns `{ run, stop, runSection, runAndAdvance, runWarning }` where `runWarning` is a string or null
- [ ] Typecheck passes
- [ ] All existing tests pass

### US-R08: Unit test `useScriptExecution` hook
**Description:** As a developer, I want tests for script execution flows including auto-save-before-run, function-only detection, and section execution.

**Acceptance Criteria:**
- [ ] New file `tests/unit/script-execution-hook.test.ts`
- [ ] Test: `run()` calls `saveFile()` before executing
- [ ] Test: `run()` on a saved file builds command with `buildRunScriptCommand()` and calls `onRun`
- [ ] Test: `run()` on an untitled file creates a temp file and runs from there
- [ ] Test: `run()` on a function-only file sets `runWarning` and does NOT call `onRun`
- [ ] Test: `runSection()` extracts code at cursor line using `findSectionRange()`
- [ ] Test: `runSection()` with no section headers runs entire file content
- [ ] Test: `stop()` calls `onStop`
- [ ] IPC and callbacks mocked
- [ ] Typecheck passes
- [ ] All tests pass

### US-R09: Extract `useEditorShortcuts` hook
**Description:** As a developer, I want keyboard shortcut registration in its own hook so the shortcut-to-action mapping is testable and EditorPanel doesn't handle key dispatch.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useEditorShortcuts.ts` exports `useEditorShortcuts()` hook
- [ ] Hook accepts an action map `Record<ShortcutAction, () => void>` and registers/unregisters the `ShortcutManager` listener on mount/unmount
- [ ] Hook loads custom shortcut overrides from `window.matslop.configGetShortcuts()` on mount
- [ ] Hook applies overrides via `applyShortcutOverrides()` and updates the manager's active definitions
- [ ] The `ShortcutManager` class itself is unchanged — the hook just wires it to the action map
- [ ] Typecheck passes
- [ ] All existing custom-shortcuts tests pass

### US-R10: Unit test `useEditorShortcuts` hook
**Description:** As a developer, I want tests ensuring shortcuts register on mount, unregister on unmount, and dispatch the correct actions.

**Acceptance Criteria:**
- [ ] New file `tests/unit/editor-shortcuts-hook.test.ts`
- [ ] Test: mounting the hook registers a keydown listener
- [ ] Test: unmounting the hook unregisters the keydown listener
- [ ] Test: pressing Ctrl+N dispatches the `newFile` action
- [ ] Test: pressing F5 dispatches the `run` action
- [ ] Test: pressing Ctrl+W dispatches the `closeTab` action
- [ ] Test: custom shortcut overrides are applied (e.g., rebinding run to Ctrl+R)
- [ ] Typecheck passes
- [ ] All tests pass

### US-R11: Extract `useDragDrop` hook
**Description:** As a developer, I want drag-and-drop file handling in its own hook so it doesn't add noise to the main editor component.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useDragDrop.ts` exports `useDragDrop()` hook
- [ ] Hook accepts `{ onFilesDropped: (files: { path: string, name: string }[]) => void }` and returns `{ isDragOver, dragHandlers: { onDragEnter, onDragLeave, onDragOver, onDrop } }`
- [ ] `onDragEnter`/`onDragLeave` use a counter ref to handle nested drag events (existing pattern)
- [ ] `onDrop` filters for `.m` and `.mls` files and calls `onFilesDropped` with the list
- [ ] `onDragOver` prevents default to allow drop
- [ ] `isDragOver` is true only when a valid file drag is over the drop zone
- [ ] Typecheck passes
- [ ] All existing tests pass

### US-R12: Unit test `useDragDrop` hook
**Description:** As a developer, I want tests for drag-drop file handling so edge cases (nested events, non-file drags, invalid extensions) are covered.

**Acceptance Criteria:**
- [ ] New file `tests/unit/drag-drop-hook.test.ts`
- [ ] Test: `isDragOver` becomes true on `dragEnter` and false on `dragLeave`
- [ ] Test: nested `dragEnter`/`dragLeave` events don't flicker `isDragOver` (counter pattern)
- [ ] Test: `onDrop` with `.m` files calls `onFilesDropped` with correct paths
- [ ] Test: `onDrop` with `.mls` files calls `onFilesDropped` with correct paths
- [ ] Test: `onDrop` with non-.m/.mls files does not call `onFilesDropped`
- [ ] Test: `isDragOver` resets to false after drop
- [ ] Typecheck passes
- [ ] All tests pass

### US-R13: Extract `useMenuActions` hook
**Description:** As a developer, I want menu action dispatch (File > Save, Edit > Find, Run > Run Section, etc.) in its own hook so menu-to-action wiring is isolated.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useMenuActions.ts` exports `useMenuActions()` hook
- [ ] Hook accepts `{ menuAction, onMenuActionConsumed, actions }` where `actions` maps menu action strings to handler functions
- [ ] Hook processes `menuAction` in a `useEffect`, dispatches to the correct handler, and calls `onMenuActionConsumed`
- [ ] Hook tracks the last processed menu action ID to prevent duplicate processing (existing `lastMenuActionIdRef` pattern)
- [ ] Menu actions handled: `save`, `saveAs`, `newFile`, `newLiveScript`, `openFile`, `closeTab`, `run`, `runSection`, `runAndAdvance`, `publishHtml`, and `recentFile:*` prefix
- [ ] Typecheck passes
- [ ] All existing tests pass

### US-R14: Unit test `useMenuActions` hook
**Description:** As a developer, I want tests for menu action dispatch so duplicate processing and missing handlers are caught.

**Acceptance Criteria:**
- [ ] New file `tests/unit/menu-actions-hook.test.ts`
- [ ] Test: receiving a `save` menu action calls the `save` handler
- [ ] Test: receiving the same menu action ID twice only calls the handler once
- [ ] Test: `recentFile:/path/to/file.m` menu action calls the file-open handler with the path
- [ ] Test: unknown menu action does not crash and calls `onMenuActionConsumed`
- [ ] Typecheck passes
- [ ] All tests pass

### US-R15: Extract `useDebugIntegration` hook
**Description:** As a developer, I want debugger-related editor behavior (auto-open paused file, edit-and-continue warning, breakpoint reapplication) in its own hook.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/useDebugIntegration.ts` exports `useDebugIntegration()` hook
- [ ] Hook accepts `{ pausedLocation, tabs, activeTabId, dispatch, editorInstance, onFileSavedWhilePaused }`
- [ ] When `pausedLocation` changes to a file not currently open, the hook reads the file and dispatches `CREATE_TAB` + `SELECT_TAB`
- [ ] When `pausedLocation` changes to a file already open, the hook dispatches `SELECT_TAB`
- [ ] After activating the paused tab, the hook moves the cursor to the paused line
- [ ] When a file is saved while `pausedLocation` is non-null, the hook calls `onFileSavedWhilePaused` and calls `debugReapplyBreakpointsForFile`
- [ ] The hook exposes `isPaused: boolean` derived from `pausedLocation !== null`
- [ ] Typecheck passes
- [ ] All existing tests pass

### US-R16: Unit test `useDebugIntegration` hook
**Description:** As a developer, I want tests for debugger integration so auto-tab-switch and edit-and-continue flows are verified.

**Acceptance Criteria:**
- [ ] New file `tests/unit/debug-integration-hook.test.ts`
- [ ] Test: when `pausedLocation` points to an open file, dispatches `SELECT_TAB`
- [ ] Test: when `pausedLocation` points to a file not in tabs, reads the file and dispatches `CREATE_TAB` + `SELECT_TAB`
- [ ] Test: when `pausedLocation` is null, `isPaused` is false
- [ ] Test: saving a file while paused calls `onFileSavedWhilePaused` with the file path
- [ ] Test: saving a file while paused calls `debugReapplyBreakpointsForFile`
- [ ] IPC calls mocked
- [ ] Typecheck passes
- [ ] All tests pass

### US-R17: Rewrite EditorPanel to compose extracted hooks
**Description:** As a developer, I want EditorPanel to be a thin composition layer that wires the extracted hooks together, with no business logic of its own.

**Acceptance Criteria:**
- [ ] `EditorPanel.tsx` uses `useTabReducer()` for all tab state
- [ ] `EditorPanel.tsx` uses `useSessionPersistence()` for session save/restore
- [ ] `EditorPanel.tsx` uses `useFileOperations()` for open/save/save-as
- [ ] `EditorPanel.tsx` uses `useScriptExecution()` for run/stop/section
- [ ] `EditorPanel.tsx` uses `useEditorShortcuts()` for keyboard shortcuts
- [ ] `EditorPanel.tsx` uses `useDragDrop()` for drag-and-drop
- [ ] `EditorPanel.tsx` uses `useMenuActions()` for menu dispatch
- [ ] `EditorPanel.tsx` uses `useDebugIntegration()` for debugger features
- [ ] EditorPanel is under 200 lines (composition + JSX only)
- [ ] No `useState` or `useRef` calls remain in EditorPanel except for the editor instance ref (needed for Monaco)
- [ ] The `welcomeTabId` state, `welcomeTabIdRef`, and `welcomeInitRef` are completely removed
- [ ] The Welcome tab is no longer created on startup — new users see the empty "No files open" state from TabbedEditor
- [ ] WelcomeTab.tsx is deleted
- [ ] All welcome-related CSS (`.welcome-*`) is removed
- [ ] The `onCloseWelcome` prop is removed from TabbedEditor
- [ ] All existing E2E tests pass (any that assert on Welcome tab should be updated)
- [ ] Typecheck passes

### US-R18: Refactor TabbedEditor to simplify internal state
**Description:** As a developer, I want TabbedEditor to be a pure rendering component that receives all state via props and has no internal tab logic.

**Acceptance Criteria:**
- [ ] TabbedEditor receives `tabs`, `activeTabId`, and renders the tab bar + content
- [ ] TabbedEditor still manages its own Monaco editor instance internally (this is rendering concern)
- [ ] TabbedEditor still manages breakpoint decorations, diagnostics, and section decorations internally (these are Monaco rendering concerns)
- [ ] TabbedEditor does NOT manage tab lifecycle, selection, or close logic — these come via `onTabSelect`, `onTabClose` callbacks
- [ ] The conditional rendering for Welcome mode is removed (since Welcome tab is deleted)
- [ ] Typecheck passes
- [ ] All existing E2E tests pass

### US-R19: Extract editor CSS into scoped files
**Description:** As a developer, I want editor CSS in its own files so changes to editor styling don't risk regressions in unrelated panels.

**Acceptance Criteria:**
- [ ] New file `src/renderer/editor/editor.css` contains all `.editor-*`, `.tabbed-*`, `.toolbar-*` rules extracted from `styles.css`
- [ ] New file `src/renderer/editor/livescript.css` contains all `.ls-*` rules extracted from `styles.css`
- [ ] New file `src/renderer/editor/toolbar-dropdown.css` contains the `.toolbar-split-btn`, `.toolbar-dropdown`, `.toolbar-dropdown-item` rules (currently in `styles.css`)
- [ ] `styles.css` no longer contains any `.editor-*`, `.tabbed-*`, `.toolbar-*`, `.ls-*`, `.welcome-*`, `.matslop-breakpoint-*`, `.matslop-paused-*`, `.matslop-section-*` rules
- [ ] `editor.css` is imported by `TabbedEditor.tsx`
- [ ] `livescript.css` is imported by `LiveScriptEditor.tsx`
- [ ] `toolbar-dropdown.css` is imported by `EditorToolbar.tsx`
- [ ] Drop overlay CSS (`.drop-overlay`, `.drop-overlay-content`) stays in `styles.css` or moves to a general `components.css` (it's used beyond the editor)
- [ ] Visual appearance is unchanged — no regressions in dark or light themes
- [ ] Typecheck passes

### US-R20: Remove stale code and dead references
**Description:** As a developer, I want all code made dead by this refactor to be cleaned up so the codebase doesn't accumulate unused exports.

**Acceptance Criteria:**
- [ ] `WelcomeTab.tsx` is deleted
- [ ] `syncNextTabId()` in `editorTypes.ts` is removed (the reducer handles ID sync internally)
- [ ] The global `nextId` counter in `editorTypes.ts` is removed (moved into the reducer module)
- [ ] `createTab()` in `editorTypes.ts` is updated to use the reducer's ID generator, OR is kept as a standalone factory that the reducer calls internally
- [ ] No unused imports remain in any modified file
- [ ] No `// eslint-disable` comments were added to suppress new warnings
- [ ] `grep -r "welcomeTab" src/` returns zero matches
- [ ] `grep -r "WelcomeTab" src/` returns zero matches
- [ ] `grep -r "welcomeInitRef" src/` returns zero matches
- [ ] Typecheck passes
- [ ] Lint passes with zero warnings in modified files

### US-R21: Component test for EditorPanel composition
**Description:** As a developer, I want a component test that verifies EditorPanel correctly wires all hooks together — tab creation, file open, close with dirty check, and session restore.

**Acceptance Criteria:**
- [ ] New file `tests/unit/editor-panel.test.tsx`
- [ ] Uses `@testing-library/react` with `render()` — not Playwright E2E
- [ ] Mocks all `window.matslop.*` IPC calls
- [ ] Mocks Monaco editor (since it requires a DOM that jsdom can't fully provide — use a stub)
- [ ] Test: on mount with no session, renders "No files open" empty state
- [ ] Test: on mount with a saved session, restores tabs and shows the active tab
- [ ] Test: clicking "New File" in the empty state creates a new tab
- [ ] Test: Ctrl+W on a clean tab closes it without a dialog
- [ ] Test: Ctrl+W on a dirty tab triggers `confirmClose` dialog
- [ ] Typecheck passes
- [ ] All tests pass

### US-R22: Component test for TabbedEditor rendering
**Description:** As a developer, I want a component test that verifies TabbedEditor renders tabs correctly, shows active tab content, and dispatches close/select callbacks.

**Acceptance Criteria:**
- [ ] New file `tests/unit/tabbed-editor.test.tsx`
- [ ] Uses `@testing-library/react` with `render()`
- [ ] Mocks Monaco editor component
- [ ] Test: renders tab names in the tab bar
- [ ] Test: active tab has the `active` CSS class
- [ ] Test: clicking a tab calls `onTabSelect` with the tab ID
- [ ] Test: clicking the `×` button calls `onTabClose` with the tab ID
- [ ] Test: modified tab shows the unsaved-changes dot
- [ ] Test: with zero tabs, renders the "No files open" empty state
- [ ] Typecheck passes
- [ ] All tests pass

### US-R23: Component test for EditorToolbar
**Description:** As a developer, I want a component test for the toolbar so button states (disabled, dropdown) are verified without E2E.

**Acceptance Criteria:**
- [ ] New file `tests/unit/editor-toolbar.test.tsx`
- [ ] Uses `@testing-library/react` with `render()`
- [ ] Test: "New File" button calls `onNewFile` on click
- [ ] Test: dropdown chevron toggles the new-file dropdown menu
- [ ] Test: clicking "Live Script (.mls)" in dropdown calls `onNewLiveScript`
- [ ] Test: dropdown closes when clicking outside
- [ ] Test: Run button is disabled when `hasActiveFile` is false
- [ ] Test: Run button is disabled when engine status is `busy`
- [ ] Test: Save button is disabled when `hasActiveFile` is false
- [ ] Typecheck passes
- [ ] All tests pass

### US-R24: Configure vitest for React component tests
**Description:** As a developer, I want vitest properly configured to run React component tests with jsdom so `@testing-library/react` works.

**Acceptance Criteria:**
- [ ] `vitest.config.ts` is updated to support both `node` environment (existing unit tests) and `jsdom` environment (new component tests)
- [ ] This is done via either: a vitest workspace config, or an `environmentMatchGlobs` option that applies jsdom to `tests/unit/**/*.test.tsx` files
- [ ] The `@testing-library/react` import works in `.test.tsx` files
- [ ] The `@testing-library/dom` import works in `.test.tsx` files
- [ ] Running `npm test` runs both existing node-environment tests and new jsdom-environment tests
- [ ] No existing tests are broken by the config change
- [ ] Typecheck passes

### US-R25: Update E2E tests for Welcome tab removal
**Description:** As a developer, I want all E2E tests updated to not depend on the Welcome tab since it's been removed.

**Acceptance Criteria:**
- [ ] `tests/e2e/startup.spec.ts` is updated — no longer asserts Welcome tab exists
- [ ] Any E2E test that clicks "Get Started" or interacts with the Welcome tab is updated
- [ ] Any E2E test that filters out the Welcome tab when counting editor tabs is simplified
- [ ] All 40 E2E tests pass
- [ ] Typecheck passes

### US-R26: Integration test — full tab lifecycle
**Description:** As a developer, I want an integration test that exercises the full tab lifecycle (create → edit → save → close with dirty check → reopen from session) using the real hooks composed together.

**Acceptance Criteria:**
- [ ] New file `tests/unit/tab-lifecycle-integration.test.tsx`
- [ ] Uses `@testing-library/react` with `renderHook`
- [ ] Composes `useTabReducer` + `useSessionPersistence` + `useFileOperations` together
- [ ] Test: create a tab → update content → save → content matches savedContent
- [ ] Test: create a tab → update content → close → unsaved check fires (callback called with dirty tab)
- [ ] Test: create 3 tabs → close the middle one → active tab moves correctly
- [ ] Test: create tabs → trigger session save → restore from saved data → tabs match
- [ ] Test: restore session with IDs [tab-1, tab-5, tab-3] → create new tab → gets tab-6
- [ ] IPC calls mocked
- [ ] Typecheck passes
- [ ] All tests pass

## Functional Requirements

- FR-1: All tab state mutations (create, close, select, update, restore) go through a single `useReducer` dispatch
- FR-2: Tab ID generation guarantees uniqueness across session restores and HMR reloads
- FR-3: Session persistence is decoupled from tab management — changing the save format requires modifying only `useSessionPersistence`
- FR-4: File I/O operations (open, save, save-as) are decoupled from tab state — they dispatch reducer actions
- FR-5: Script execution is decoupled from file I/O — it calls `saveFile` from the file operations hook, not directly
- FR-6: Keyboard shortcuts, menu actions, drag-drop, and debug integration are each isolated in their own hooks
- FR-7: EditorPanel.tsx is a pure composition layer under 200 lines
- FR-8: The Welcome tab feature is completely removed — no code, CSS, or test references remain
- FR-9: Editor CSS is in scoped files, not in the global `styles.css`
- FR-10: Component-level tests exist for EditorPanel, TabbedEditor, and EditorToolbar
- FR-11: vitest supports both node and jsdom environments for unit and component tests respectively
- FR-12: All 42 existing unit tests, 6 integration tests, and 40 E2E tests continue to pass

## Non-Goals

- No changes to the Monaco editor configuration or language support
- No changes to the LiveScript editor's cell execution or rendering logic (except CSS extraction)
- No changes to the breakpoint store, diagnostic analyzer, or section detection logic (these are already well-tested pure functions)
- No changes to the rc-dock layout or MatslopDockLayout.tsx
- No changes to the main process, preload script, or IPC bridge
- No new features — this is purely a refactor for maintainability
- No performance optimization (the current performance is acceptable)
- No changes to the Octave process management or plotting pipeline

## Technical Considerations

- `@testing-library/react` (v16.3.2) and `jsdom` (v29.0.2) are already installed as devDependencies but unused. This refactor activates them.
- The `useReducer` pattern eliminates the need for `tabsRef`, `activeTabIdRef`, and `welcomeTabIdRef` — the reducer state is always the single source of truth.
- Monaco editor cannot be fully rendered in jsdom. Component tests should mock the `@monaco-editor/react` `Editor` component as a simple div.
- The `AppContext` fallback pattern (props vs context) should remain as-is in the rewritten EditorPanel — it's needed for rc-dock stale-prop workaround.
- Each hook should be in its own file for tree-shaking and test isolation.
- The extracted CSS files should use the exact same selectors and property values — no visual changes.

## Success Metrics

- EditorPanel.tsx is under 200 lines (down from 1,098)
- Zero `useState` calls remain in EditorPanel (except rendering-only concerns)
- 8 new hook files, each under 150 lines
- 12 new test files with 60+ test cases
- All 88 existing tests pass without modification (except Welcome-tab-related E2E tests)
- No user-facing behavior changes except Welcome tab removal

## Open Questions

- None — scope is fully defined. The refactor is internal; the user-facing behavior is identical except for the Welcome tab removal.

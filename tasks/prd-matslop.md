# PRD: MatSlop - Open-Source MATLAB Alternative

## Introduction

MatSlop is a free, open-source desktop IDE that replicates the MATLAB desktop experience. It provides a text editor with MATLAB syntax highlighting, an integrated command window (terminal), a workspace/variable viewer, a file browser, plotting capabilities, and support for both normal `.m` scripts and live scripts. The computation engine is GNU Octave, which provides near-complete compatibility with core MATLAB syntax and functions. The long-term goal is to fully replace MATLAB in professional workflows, including eventually recreating commonly-used MATLAB toolbox functionality.

## Goals

- Provide a free, cross-platform (Linux, macOS, Windows) MATLAB-like IDE
- Support all core MATLAB commands that do not require additional toolboxes (via GNU Octave)
- Offer a familiar, professional IDE layout: editor, command window, workspace viewer, file browser, figure windows
- Support both `.m` script files and live scripts (`.mlx`-like interactive notebooks)
- Achieve full syntax compatibility with MATLAB's core language
- Feel responsive, polished, and production-ready — not a toy or prototype
- Be extensible so that MATLAB toolbox replacements can be added over time

## User Stories

### US-001: Electron App Scaffold and Build System
**Description:** As a developer, I need the base Electron + React + TypeScript project scaffolded with a working build system so that all subsequent features have a foundation to build on.

**Acceptance Criteria:**
- [ ] Electron app launches with a blank React-rendered window
- [ ] TypeScript compilation works with strict mode enabled
- [ ] Hot-reload works in development mode (`npm run dev`)
- [ ] Production build works (`npm run build`) and produces platform binaries
- [ ] ESLint and Prettier configured with reasonable defaults
- [ ] Package.json includes scripts: `dev`, `build`, `lint`, `typecheck`
- [ ] Typecheck passes
- [ ] Lint passes

### US-002: Main Window Layout with Resizable Panel System
**Description:** As a user, I want a MATLAB-like IDE layout with resizable panels so that I can arrange my workspace comfortably.

**Acceptance Criteria:**
- [ ] Main window has a menu bar at the top
- [ ] Layout has four panels: Editor (center), Command Window (bottom), Workspace (top-right), File Browser (left sidebar)
- [ ] Panels are resizable by dragging dividers
- [ ] Panels can be collapsed/expanded
- [ ] Layout state persists across app restarts (saved to local config)
- [ ] Minimum panel sizes prevent panels from being dragged to zero
- [ ] Typecheck passes

### US-003: Monaco Editor Integration with .m Syntax Highlighting
**Description:** As a user, I want a code editor with MATLAB syntax highlighting, line numbers, and standard editor features so that I can write .m files comfortably.

**Acceptance Criteria:**
- [ ] Monaco Editor embedded in the Editor panel
- [ ] Custom MATLAB/Octave language definition registered (keywords, operators, comments, strings)
- [ ] Syntax highlighting for: keywords (`if`, `else`, `for`, `while`, `function`, `end`, `switch`, `case`, `try`, `catch`, `classdef`, `return`, `break`, `continue`), comments (`%`, `%{ %}` blocks), strings (single-quoted `'...'` and double-quoted `"..."`), numbers, operators, matrix brackets
- [ ] Line numbers displayed
- [ ] Code folding for functions, if/else, for/while blocks
- [ ] Multiple tabs for multiple open files
- [ ] Standard keyboard shortcuts (Ctrl+S save, Ctrl+Z undo, Ctrl+F find, etc.)
- [ ] Tab shows filename; modified files show a dot indicator
- [ ] Typecheck passes

### US-004: File Open, Save, Save As, and New File
**Description:** As a user, I want to create, open, and save .m files so that I can manage my scripts.

**Acceptance Criteria:**
- [ ] File > New creates a new untitled tab in the editor
- [ ] File > Open shows native file dialog filtered to `.m` files, opens selected file in a new tab
- [ ] File > Save writes current tab contents to disk (prompts for path if untitled)
- [ ] File > Save As prompts for new path and saves
- [ ] Ctrl+S triggers save, Ctrl+Shift+S triggers Save As
- [ ] Unsaved changes prompt "Save changes?" dialog on close
- [ ] File watcher detects external changes and prompts to reload
- [ ] Typecheck passes

### US-005: File Browser Panel
**Description:** As a user, I want a file browser panel showing the current working directory so that I can navigate and open files.

**Acceptance Criteria:**
- [ ] File Browser panel shows directory tree of the current working directory
- [ ] Directories are expandable/collapsible with arrow icons
- [ ] Files show appropriate icons (special icon for `.m` files, folders, etc.)
- [ ] Double-clicking a `.m` file opens it in the editor
- [ ] Right-click context menu with: Open, Rename, Delete, New File, New Folder
- [ ] Current working directory path shown at the top with a "Change Directory" button
- [ ] File browser updates when files are created/deleted externally (via file watcher)
- [ ] Typecheck passes

### US-006: GNU Octave Backend Process Manager
**Description:** As a developer, I need a backend service that manages a GNU Octave child process so that the app can execute MATLAB-compatible commands.

**Acceptance Criteria:**
- [ ] On app startup, spawns a GNU Octave process in interactive mode
- [ ] Octave process runs with `--no-gui --interactive --no-history` flags
- [ ] Can send commands to Octave via stdin and capture stdout/stderr output
- [ ] Detects when a command finishes executing (parses Octave's prompt marker)
- [ ] Handles Octave process crashes gracefully — shows error and offers restart
- [ ] Can interrupt running commands (sends SIGINT to Octave process)
- [ ] Properly terminates Octave process on app quit
- [ ] Exposes an IPC API from main process to renderer: `executeCommand(cmd) -> {output, error}`
- [ ] Typecheck passes

### US-007: Command Window (Terminal Panel)
**Description:** As a user, I want a command window where I can type MATLAB commands interactively, just like MATLAB's Command Window.

**Acceptance Criteria:**
- [ ] Command Window panel at the bottom of the IDE
- [ ] Shows `>>` prompt for input
- [ ] User can type commands and press Enter to execute via Octave backend
- [ ] Command output displayed below the input, preserving formatting
- [ ] Error messages displayed in red text
- [ ] Command history accessible with Up/Down arrow keys
- [ ] Supports multi-line input (using `...` continuation or Shift+Enter)
- [ ] Can interrupt running command with Ctrl+C
- [ ] Scrollable output with auto-scroll to bottom on new output
- [ ] Clear command window with `clc` command or right-click > Clear
- [ ] Typecheck passes

### US-008: Run .m Script from Editor
**Description:** As a user, I want to run the current .m script from the editor and see output in the command window.

**Acceptance Criteria:**
- [ ] "Run" button (green play icon) in the editor toolbar
- [ ] F5 keyboard shortcut runs the current file
- [ ] Running a script auto-saves the file first
- [ ] Script executes via Octave backend, output appears in Command Window
- [ ] Current working directory is set to the script's directory before execution
- [ ] "Run Section" button runs only the selected code (or current cell delimited by `%%`)
- [ ] Running script name appears in a status bar indicator
- [ ] Errors show clickable file:line references that navigate to the error location in the editor
- [ ] Typecheck passes

### US-009: Workspace / Variable Viewer Panel
**Description:** As a user, I want to see all variables in my current workspace with their names, sizes, types, and values — just like MATLAB's Workspace panel.

**Acceptance Criteria:**
- [ ] Workspace panel shows a table with columns: Name, Value (preview), Size, Class
- [ ] After each command execution, workspace refreshes automatically by querying Octave (`whos`)
- [ ] Scalar values show their value directly in the Value column
- [ ] Vectors/matrices show dimensions (e.g., "3x3 double")
- [ ] Strings show a truncated preview
- [ ] Structs show field count
- [ ] Cell arrays show dimensions
- [ ] Double-clicking a variable opens a Variable Inspector dialog showing full contents
- [ ] Right-click context menu: Delete Variable, Rename, Plot (for numeric arrays)
- [ ] Variables are sorted alphabetically by default
- [ ] Typecheck passes

### US-010: Variable Inspector Dialog
**Description:** As a user, I want to double-click a variable in the workspace to view and edit its full contents in a spreadsheet-like view.

**Acceptance Criteria:**
- [ ] Double-clicking a matrix/vector in workspace opens a modal/panel with spreadsheet grid
- [ ] Grid shows numeric values in editable cells
- [ ] Editing a cell updates the variable in Octave workspace
- [ ] Struct variables show fields in a key-value list
- [ ] Cell arrays show contents in a grid with type indicators
- [ ] String variables show full text in a text area
- [ ] Dialog title shows variable name, size, and class
- [ ] Close button returns to main view
- [ ] Typecheck passes

### US-011: Plot/Figure Window Support
**Description:** As a user, I want plotting commands (plot, scatter, bar, etc.) to display figures in a separate window or docked panel, just like MATLAB.

**Acceptance Criteria:**
- [ ] `plot()`, `scatter()`, `bar()`, `histogram()`, `surf()`, `mesh()`, `contour()`, `imagesc()` commands produce visible figure windows
- [ ] Figures render using Octave's `gnuplot` or `qt` graphics backend, captured and displayed in the app
- [ ] Each figure opens in its own tab or floating window
- [ ] Figures can be resized
- [ ] Figure toolbar with: zoom in, zoom out, pan, save as image (PNG, SVG, PDF)
- [ ] `title()`, `xlabel()`, `ylabel()`, `legend()` annotations render correctly
- [ ] `subplot()` layouts work correctly
- [ ] `hold on`/`hold off` for overlaying plots works
- [ ] Closing figure window runs `close` on that figure handle
- [ ] Typecheck passes

### US-012: Status Bar
**Description:** As a user, I want a status bar at the bottom of the IDE showing useful state information.

**Acceptance Criteria:**
- [ ] Status bar at the very bottom of the window
- [ ] Shows current working directory (left side)
- [ ] Shows Octave engine status: "Ready", "Busy", or "Disconnected" with colored indicator
- [ ] Shows cursor position (line:column) for the active editor tab
- [ ] Shows file encoding (UTF-8)
- [ ] Typecheck passes

### US-013: Editor Toolbar with Run Controls
**Description:** As a user, I want a toolbar above the editor with buttons for common actions.

**Acceptance Criteria:**
- [ ] Toolbar with icon buttons: New File, Open File, Save, Run (green play), Stop (red square), Run Section
- [ ] Buttons have tooltips showing name and keyboard shortcut
- [ ] Run button is disabled when no file is open
- [ ] Stop button is disabled when no command is running, enabled when Octave is busy
- [ ] Buttons use consistent icon style (e.g., Lucide or similar icon set)
- [ ] Typecheck passes

### US-014: MATLAB-Compatible Current Directory Management
**Description:** As a user, I want `cd`, `pwd`, `ls`, `dir` commands to work and keep the IDE's file browser in sync.

**Acceptance Criteria:**
- [ ] `cd` command in Command Window changes Octave's working directory AND updates the File Browser panel
- [ ] `pwd` returns the current directory
- [ ] `ls` and `dir` list directory contents
- [ ] Changing directory via File Browser's "Change Directory" button updates Octave's `cd` and the status bar
- [ ] `addpath` and `rmpath` work for managing the Octave path
- [ ] Typecheck passes

### US-015: Command History Panel
**Description:** As a user, I want a searchable command history so I can recall and re-run previous commands.

**Acceptance Criteria:**
- [ ] Command History panel (can be toggled from View menu)
- [ ] Shows all commands executed in current and previous sessions
- [ ] Double-clicking a history entry pastes it into the Command Window
- [ ] Search/filter box at top of history panel
- [ ] History persists across app restarts (saved to local file)
- [ ] Right-click context menu: Copy, Execute, Delete from History
- [ ] Typecheck passes

### US-016: Live Script Support (Interactive Notebook Mode)
**Description:** As a user, I want to create and edit live scripts — interactive documents mixing code, output, and rich text — similar to MATLAB Live Scripts (.mlx).

**Acceptance Criteria:**
- [ ] File > New Live Script creates a `.mls` file (MatSlop Live Script) opened in notebook mode
- [ ] Notebook has cells that can be either "Code" or "Text" (Markdown)
- [ ] Code cells have a Run button that executes the cell and shows output inline below the cell
- [ ] Text cells support Markdown rendering (headers, bold, italic, lists, links)
- [ ] Can add cells above/below with + button between cells
- [ ] Can delete cells with a delete button on each cell
- [ ] Can reorder cells via drag-and-drop
- [ ] Code cells have MATLAB syntax highlighting (reusing Monaco)
- [ ] "Run All" button executes all code cells top-to-bottom
- [ ] Output includes text output and inline plot rendering
- [ ] Live script state saved to a JSON-based `.mls` file format
- [ ] Typecheck passes

### US-017: Live Script Plot Inline Rendering
**Description:** As a user, I want plots generated in live script code cells to render inline below the cell, like MATLAB Live Scripts.

**Acceptance Criteria:**
- [ ] When a code cell contains a plot command, the figure renders as an image below that cell
- [ ] Uses Octave's `print` command to export figure to PNG, then displays inline
- [ ] Multiple plots in one cell all render below
- [ ] Inline plots are resizable
- [ ] Right-click on inline plot: Save As Image, Copy to Clipboard, Open in Figure Window
- [ ] Typecheck passes

### US-018: Application Menu Bar
**Description:** As a user, I want a standard application menu bar with all expected IDE menu options.

**Acceptance Criteria:**
- [ ] File menu: New Script, New Live Script, Open, Save, Save As, Close Tab, Recent Files, Exit
- [ ] Edit menu: Undo, Redo, Cut, Copy, Paste, Find & Replace, Go to Line, Select All
- [ ] View menu: Toggle Command Window, Toggle Workspace, Toggle File Browser, Toggle Command History, Toggle Status Bar, Reset Layout
- [ ] Run menu: Run Script (F5), Run Section, Stop Execution, Clear Command Window
- [ ] Help menu: About MatSlop, Octave Documentation (opens web link)
- [ ] All menu items show keyboard shortcuts
- [ ] Menu items are disabled when not applicable (e.g., Save when no file open)
- [ ] Typecheck passes

### US-019: Theme Support (Light and Dark Mode)
**Description:** As a user, I want to switch between light and dark themes so I can work comfortably in any lighting.

**Acceptance Criteria:**
- [ ] App ships with a light theme and a dark theme
- [ ] Theme toggle in View menu: Light / Dark / System
- [ ] All panels, editor, menus, dialogs styled consistently per theme
- [ ] Monaco editor theme switches accordingly (vs-light / vs-dark)
- [ ] Theme preference persists across restarts
- [ ] Default theme follows system preference
- [ ] Typecheck passes

### US-020: Auto-Complete and IntelliSense for MATLAB Functions
**Description:** As a user, I want auto-complete suggestions for MATLAB/Octave built-in functions and my own defined functions while typing in the editor.

**Acceptance Criteria:**
- [ ] Typing in editor triggers auto-complete popup after 2+ characters
- [ ] Suggestions include all Octave built-in functions (comprehensive list)
- [ ] Suggestions include user-defined functions from open files and current directory `.m` files
- [ ] Suggestions include variable names currently in workspace
- [ ] Selecting a suggestion inserts it
- [ ] Function signatures shown in tooltip (e.g., `plot(X, Y, LineSpec)`)
- [ ] Typecheck passes

### US-021: Error Highlighting and Diagnostics in Editor
**Description:** As a user, I want syntax errors highlighted in the editor before I run my code, similar to MATLAB's live error checking.

**Acceptance Criteria:**
- [ ] Basic syntax errors underlined in red (unclosed brackets, missing `end`, invalid syntax)
- [ ] Error messages shown on hover over underlined code
- [ ] Warnings shown with yellow underline (e.g., unused variables if detectable)
- [ ] Diagnostics update as user types (debounced, ~500ms delay)
- [ ] Error count shown in status bar
- [ ] Typecheck passes

### US-022: Keyboard Shortcuts and Shortcut Customization
**Description:** As a user, I want standard keyboard shortcuts that match MATLAB conventions.

**Acceptance Criteria:**
- [ ] F5: Run script
- [ ] Ctrl+C (in Command Window): Interrupt execution
- [ ] Ctrl+Enter: Run current section/cell
- [ ] Ctrl+N: New file
- [ ] Ctrl+O: Open file
- [ ] Ctrl+S: Save
- [ ] Ctrl+W: Close tab
- [ ] Ctrl+F: Find in editor
- [ ] Ctrl+G: Go to line
- [ ] Ctrl+/: Toggle comment on selected lines
- [ ] Tab: Indent selected lines
- [ ] Shift+Tab: Unindent selected lines
- [ ] All shortcuts listed in Help > Keyboard Shortcuts dialog
- [ ] Typecheck passes

### US-023: Preferences/Settings Dialog
**Description:** As a user, I want a preferences dialog to customize editor behavior, font sizes, and other settings.

**Acceptance Criteria:**
- [ ] Preferences dialog accessible from Edit > Preferences (or MatSlop > Preferences on macOS)
- [ ] Settings: Font family, font size, tab size (2/4/8 spaces), insert spaces vs tabs
- [ ] Settings: Auto-save on run (on/off), auto-save interval
- [ ] Settings: Theme selection
- [ ] Settings: Octave executable path (auto-detected with manual override)
- [ ] Settings: Default working directory
- [ ] Settings persisted to a JSON config file in the user's config directory
- [ ] Changes apply immediately (no restart required)
- [ ] Typecheck passes

### US-024: Octave Path Auto-Detection and Configuration
**Description:** As a developer, I need the app to automatically find the GNU Octave installation or let the user configure it.

**Acceptance Criteria:**
- [ ] On first launch, searches common paths for `octave-cli` or `octave` binary: `/usr/bin/octave`, `/usr/local/bin/octave`, `/opt/homebrew/bin/octave`, `C:\Program Files\GNU Octave\*\bin\octave-cli.exe`, and PATH
- [ ] If found, stores path in settings and starts engine
- [ ] If NOT found, shows a friendly dialog: "GNU Octave not found. Please install it or set the path manually." with a link to Octave download page and a "Browse..." button
- [ ] Settings dialog allows changing Octave path at any time
- [ ] Validates the path points to a working Octave binary before accepting
- [ ] Typecheck passes

### US-025: Cross-Platform Build and Packaging
**Description:** As a developer, I need the app to build distributable packages for Linux, macOS, and Windows.

**Acceptance Criteria:**
- [ ] `npm run build:linux` produces AppImage and/or .deb
- [ ] `npm run build:mac` produces .dmg
- [ ] `npm run build:win` produces .exe installer (NSIS) and/or portable .zip
- [ ] electron-builder (or electron-forge) configured for all three platforms
- [ ] App icon set for all platforms
- [ ] App name "MatSlop" and version from package.json used in builds
- [ ] Typecheck passes

### US-026: Drag-and-Drop File Opening
**Description:** As a user, I want to drag .m files from my file manager into the editor to open them.

**Acceptance Criteria:**
- [ ] Dragging a `.m` file onto the editor area opens it in a new tab
- [ ] Dragging a `.mls` file opens it in live script mode
- [ ] Visual drop indicator shown when dragging over the editor area
- [ ] Dragging non-supported files shows "unsupported file type" message
- [ ] Typecheck passes

### US-027: Find and Replace in Editor
**Description:** As a user, I want find and replace functionality in the editor with regex support.

**Acceptance Criteria:**
- [ ] Ctrl+F opens find bar in current editor tab
- [ ] Ctrl+H opens find-and-replace bar
- [ ] Search highlights all matches in the document
- [ ] Options: Case sensitive, Whole word, Regex
- [ ] Replace one / Replace all buttons
- [ ] Match count displayed (e.g., "3 of 12")
- [ ] Enter goes to next match, Shift+Enter to previous
- [ ] Esc closes find bar
- [ ] Typecheck passes

### US-028: Welcome Tab on First Launch
**Description:** As a user, I want to see a welcome tab on first launch with getting-started information.

**Acceptance Criteria:**
- [ ] On first launch (no previous config), a "Welcome to MatSlop" tab opens in the editor area
- [ ] Welcome tab shows: app name/logo, version, quick-start tips, links to Octave documentation
- [ ] "Don't show again" checkbox
- [ ] Recent files section (empty on first launch, populated after)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: The application must be an Electron desktop app using React and TypeScript for the renderer
- FR-2: The editor must use Monaco Editor with a custom MATLAB/Octave language definition
- FR-3: All computation must be executed by a GNU Octave child process managed by the Electron main process
- FR-4: The Command Window must allow interactive command execution with history navigation
- FR-5: The Workspace viewer must display all current variables with name, value preview, size, and class
- FR-6: The File Browser must show the current working directory tree and support file operations
- FR-7: Running `.m` scripts must auto-save, set the working directory, and execute via Octave
- FR-8: Plot commands must produce visible figure windows with save/export capability
- FR-9: Live scripts must support code cells and markdown text cells with inline output/plot rendering
- FR-10: The application must auto-detect or allow manual configuration of the Octave binary path
- FR-11: All panel layouts, theme preferences, and editor settings must persist across restarts
- FR-12: The app must build distributable packages for Linux, macOS, and Windows
- FR-13: All core MATLAB commands available in Octave without additional packages must work
- FR-14: The editor must provide auto-complete for built-in Octave functions and user-defined functions
- FR-15: Syntax errors must be highlighted in the editor before execution

## Non-Goals (Out of Scope)

- No Simulink or block diagram support
- No MATLAB App Designer / GUI builder (GUIDE)
- No MATLAB-specific toolbox reimplementation in this release (future goal)
- No cloud/remote execution — all computation is local
- No collaboration or multi-user features
- No mobile platform support
- No support for MEX files or C/C++ compilation integration
- No MATLAB Online-like web interface
- No Symbolic Math (unless Octave's symbolic package is installed separately)
- No direct `.mlx` file import (MatSlop uses its own `.mls` format)

## Design Considerations

- The UI should closely mirror MATLAB's default layout: editor center, command window bottom, workspace top-right, file browser left
- Use a professional, clean design — not overly styled, prioritize readability and function
- Color scheme should have a MATLAB-inspired light theme (white/blue accents) and a modern dark theme
- Icons should be clear and recognizable; use an established icon library (Lucide React recommended)
- Panel dividers should be easy to grab (minimum 4px drag handle)

## Technical Considerations

- **Electron** (latest stable) for the desktop shell
- **React 18+** with functional components and hooks
- **TypeScript** in strict mode throughout
- **Monaco Editor** for the code editor (same engine as VS Code)
- **GNU Octave** (7.x or 8.x+) as the computation engine, spawned as a child process
- **electron-builder** or **electron-forge** for packaging
- **IPC** between renderer and main process using Electron's `ipcMain`/`ipcRenderer` with contextBridge
- **Octave communication**: Use a delimiter-based protocol — send commands via stdin, read stdout until a known prompt marker appears
- **Figure rendering**: Use Octave's `print('-dpng', filename)` to render plots to temp PNG files, display in the app via `<img>` tags or canvas
- **State management**: React Context or Zustand for global UI state (theme, layout, open files)
- **File watching**: Use `chokidar` for file system monitoring
- **Config storage**: `electron-store` for persistent user preferences
- **Live script format**: JSON file (`.mls`) containing an array of cells, each with type ("code" or "markdown"), content, and cached output

## Success Metrics

- User can open MatSlop, write a `.m` script, run it, and see correct output — end-to-end in under 2 minutes
- All core MATLAB math functions (`sin`, `cos`, `linspace`, `zeros`, `ones`, `eye`, `inv`, `eig`, `fft`, `plot`, etc.) execute correctly
- Variable viewer accurately reflects workspace state after every command
- Plotting commands produce visible, interactive figures
- App launches in under 3 seconds on modern hardware
- App runs on Linux, macOS, and Windows without platform-specific bugs

## Open Questions

- Should we support Octave's own package manager (`pkg`) from within the IDE for installing additional Octave packages?
- Should we add a "MATLAB Compatibility Checker" that warns when using Octave-specific or non-MATLAB syntax?
- Should `.mls` live scripts be exportable to PDF or HTML?
- Should we support multiple Octave kernels (e.g., for parallel execution)?

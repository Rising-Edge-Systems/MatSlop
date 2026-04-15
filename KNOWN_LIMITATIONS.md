# Known Limitations

Current state: 800+ unit tests pass, 27 CDP integration tests pass, typecheck clean.
Editor refactored into focused hooks with useReducer-based tab state.

---

## Working Features

- **Editor**: Open, edit, save .m and .mls files. Syntax highlighting. Multiple tabs. Session restore.
- **Live Scripts**: Notebook-style .mls files with code cells, markdown cells, inline output, inline plots.
- **Command Window**: Type Octave commands, see output. History with Up/Down.
- **Workspace**: Variables update after each command. Double-click to inspect.
- **File Browser**: Navigate directories, click to open files. Drag-and-drop support.
- **Run (F5)**: Runs .m scripts via source(). For .mls files, runs all cells.
- **Run Section (Ctrl+Enter)**: Run %% delimited sections in .m files.
- **Debugging**: Breakpoints (click gutter), conditional breakpoints (right-click gutter), Step Over (F10), Step Into (F11), Step Out (Shift+F11), Continue (F5), Stop (Shift+F5). Call stack panel, watches panel.
- **Interactive 2D plots**: plot(), scatter(), etc. with pan, zoom, hover via Plotly.js.
- **Interactive 3D plots**: surf(), mesh() with orbit rotation, zoom via Plotly.js.
- **Static PNG fallback**: bar(), hist(), stem() render as static images.
- **Dockable panels**: rc-dock layout with drag-and-drop panel rearrangement, detach to float.
- **Layout presets**: Save and restore panel arrangements.
- **Theme switching**: Dark and light themes.
- **Session restore**: Open tabs, layout, and cursor positions persist across restarts.
- **Find & Replace**: Ctrl+H with regex support in current file.
- **Find in Files**: Search across project files.
- **Help browser**: doc() integration.
- **Source control**: Git status, diff viewer.
- **Keyboard shortcuts**: Configurable via preferences.
- **Bundled Octave**: Self-contained on Windows and Linux (no user setup).

---

## Remaining Limitations

### Some plot types render as static PNG (not interactive)
`bar()`, `stem()`, and `hist()` use Octave's `hggroup` graphics objects
which `matslop_export_fig` doesn't yet support. These fall back to static
PNG rendering. Supported interactive types: `plot`, `surf`, `mesh`,
`scatter3d`, `contour`.

### macOS builds not tested
`build:mac` npm script should work but is untested on actual macOS hardware.

### Plotly modebar sometimes overlaps title
On small figure panels, the Plotly modebar (zoom/pan/save buttons) can
overlap the plot title. Resizing the panel resolves this.

### Live script cell editor uses JS-based height sizing
Cell editors in live scripts resize via JavaScript `onDidContentSizeChange`
instead of pure CSS, which can cause a brief flash of incorrect height on
first render.

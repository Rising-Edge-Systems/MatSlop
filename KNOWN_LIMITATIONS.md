# Known Limitations

Current state: 706 unit tests pass, typecheck clean.
Linux Octave bundling with interactive Plotly plotting implemented.

---

## Working Features

- **Editor**: Open, edit, save .m files. Syntax highlighting. Multiple tabs.
- **Command Window**: Type Octave commands, see output. History with Up/Down.
- **Workspace**: Variables update after each command.
- **File Browser**: Navigate directories, click to open .m files.
- **Run (F5)**: Runs the active script. Auto-saves first.
- **Debugging**: Set breakpoints (click gutter), Step Over (F10), Step Into (F11), Step Out (Shift+F11), Continue (F5), Stop (Shift+F5).
- **Interactive 2D plots**: plot(), with pan, zoom, hover, data cursors via Plotly.js.
- **Interactive 3D plots**: surf(), with orbit rotation, zoom, colorscale via Plotly.js.
- **Static PNG fallback**: bar(), hist(), stem() render as static images.
- **Busy indicator**: Status bar shows "Running..." during long commands.
- **Session restore**: Open tabs and layout persist across restarts.
- **Bundled Octave (Linux)**: Downloads from Ubuntu .deb packages with font shim.

---

## Remaining Limitations

### Some plot types render as static PNG (not interactive)
`bar()`, `stem()`, and `hist()` use Octave's `hggroup` graphics objects
which `matslop_export_fig` doesn't yet support. These fall back to static
PNG rendering. Supported interactive types: `plot`, `surf`, `mesh`,
`scatter3d`, `contour`.

### macOS / Windows builds not tested
`build:mac` and `build:win` npm scripts should work but are untested on
actual macOS or Windows hardware.

### `download-octave.js --platform darwin` pins to Octave 9.2
When `octave-app` ships a newer release, update the constant in
`scripts/download-octave.js`.

### Plotly modebar sometimes overlaps title
On small figure panels, the Plotly modebar (zoom/pan/save buttons) can
overlap the plot title. Resizing the panel resolves this.

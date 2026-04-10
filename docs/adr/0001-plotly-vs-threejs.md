# ADR 0001: Interactive JS plot library — Plotly.js vs. Three.js

* **Status:** Accepted
* **Date:** 2026-04-10
* **Owners:** MatSlop team
* **Supersedes:** none
* **Related:** US-007 (extract Octave plot data as JSON), US-008 (integrate JS plot library), US-009 (replace static PNG plots in live scripts)

## Context

Following US-007, MatSlop can now export an Octave figure (via
`matslop_export_fig`) as a JSON document conforming to the schema in
`src/main/plotSchema.ts`. We need a browser-side plotting library to
re-render that JSON as an interactive canvas inside the live-script output
column and eventually in a detached figure window. Interactive means, at a
minimum:

* Rotate 3D scenes with the mouse (drag)
* Zoom 2D and 3D with the scroll wheel
* Pan (shift-drag or middle-click)
* Hover tooltips / data cursors
* Reset view
* Export current view as PNG/SVG

The roadmap plot types we must support are: `plot`, `plot3`, `scatter`,
`scatter3`, `surf`, `mesh`, `quiver`, `quiver3`, `bar`, `bar3`, `contour`,
`contour3`, `imagesc`. That's a mix of 2D and 3D, scientific-plot
primitives. We are packaging this inside an Electron app, so bundle size
matters but network cost does not (the library ships once inside the
installer).

## Options considered

### Option A — Plotly.js (`plotly.js-dist-min`)

* **What it is:** A high-level charting library built on top of D3 and
  WebGL. Ships a large set of trace types out of the box: `scatter`,
  `scatter3d`, `surface`, `mesh3d`, `cone`, `bar`, `contour`,
  `heatmap`, `histogram`, and many more — all of the roadmap plot types
  map onto built-in Plotly traces with minimal adapter glue.
* **Bundle size:** `plotly.js-dist-min` is ~4.7 MB minified (as
  installed from npm today). There is no minified+gzipped cost we care
  about because this ships inside the Electron installer, not over the
  wire.
* **Interaction model:** Every chart type has built-in rotate (3D), zoom,
  pan, hover tooltips, a modebar with a "home" reset button, and
  `Plotly.downloadImage(gd, {format: 'png' | 'svg' | ...})` for
  exporting the current view — i.e. everything US-009, US-010 and US-011
  need, out of the box, with no per-type wiring.
* **Integration cost:** Very low. A single `Plotly.newPlot(div, data,
  layout, config)` call renders anything. The adapter layer is an
  almost mechanical transformation from our `PlotSeries` union to
  Plotly's `data` array, which keeps the renderer thin and easy to test.
* **React story:** The `react-plotly.js` wrapper exists but lags on React
  18 peer deps. We skip it and wrap `plotly.js-dist-min` ourselves in a
  `useEffect`-based component — ~30 lines.
* **Types:** `@types/plotly.js` exists. We import its namespace as a
  dev-only reference; our adapter returns a loosely-typed data array to
  keep unit tests independent of the real bundle.
* **Risk:** Plotly is opinionated about styling; matching MATLAB's default
  aesthetics exactly will take a small amount of CSS/layout work. That
  work is much smaller than building charts from scratch on a
  lower-level library.

### Option B — Three.js

* **What it is:** A general-purpose WebGL scene graph. Gives us full
  control over every pixel, but has no concept of "axes", "ticks",
  "legends", "line charts", or "bar charts" — we would have to build
  them all ourselves.
* **Bundle size:** Comparable to Plotly at ~1 MB for the core, but we'd
  pay that plus everything we build on top (axis helpers, a camera
  controller, picking, a tooltip layer, PNG export …).
* **Interaction model:** Nothing out of the box — OrbitControls handles
  rotate/zoom/pan for 3D, but 2D plots don't exist as a primitive, and
  data cursors, modebars, and image export are all hand-rolled.
* **Integration cost:** Very high. Every roadmap plot type would need its
  own mesh/line generator. Even after that investment, we'd have a
  WebGL scene graph but no subplots, no legend system, no axis ticks.
* **Risk:** Building a scientific-plot library on top of Three.js is a
  multi-quarter project. We'd likely end up rebuilding a subset of what
  Plotly already gives us.

### Option C — Chart.js or Recharts

Rejected without a detailed comparison: both are 2D-only, which fails
the roadmap's 3D requirements (`plot3`, `scatter3`, `surf`, `mesh`,
`quiver3`, `bar3`, `contour3`).

## Decision

**Adopt Plotly.js (`plotly.js-dist-min`).**

Plotly covers every roadmap plot type with a built-in trace, ships
rotate/zoom/pan/hover/reset/export for free, and keeps our adapter code
small and testable. Three.js would require us to reimplement a scientific
charting library from scratch — work that is categorically out of scope
for the MATLAB-parity roadmap.

## Consequences

### Positive

* US-009 reduces to "map `PlotFigure` → Plotly `data` + `layout`" and
  mounting a `<div>` — no custom interaction code.
* US-010 (data cursor/tooltip) is Plotly's default hover behavior plus a
  `plotly_click` handler to pin it.
* US-011 (export PNG/SVG of current view) is a single
  `Plotly.downloadImage` call with format selection.
* US-012 (detached plot window) is "open a new BrowserWindow with the
  same JSON and mount the same `PlotRenderer`".
* The adapter `figureToPlotly` is a pure function and is unit-testable
  without ever loading the 4.7 MB bundle.

### Negative / costs

* **Bundle size.** `plotly.js-dist-min@3.5.0` adds 4.7 MB of JS to the
  Electron bundle. This is a one-time installer-size cost, not a
  per-open cost, and is acceptable for a desktop scientific app. If it
  becomes a problem we can move to a custom Plotly bundle (`plotly.js`
  lets you hand-pick trace types, cutting ~60% of the size) or a lazy
  chunk that loads only when the first plot is rendered.
* **Styling drift.** Plotly's default look is not MATLAB's default look.
  We'll carry a small theme object in the renderer to close the gap.
* **No `react-plotly.js`.** We wrap the vanilla bundle ourselves in a
  thin React component (`PlotRenderer.tsx`) to avoid a React-18 peer-dep
  fight and to keep the import path `plotly.js-dist-min`.

## Bundle-size impact (measured)

```
$ du -sh node_modules/plotly.js-dist-min/plotly.min.js
4.7M  node_modules/plotly.js-dist-min/plotly.min.js
```

This is the only new runtime dependency added by US-008. `@types/plotly.js`
is a dev-only type package and does not affect the installer.

## Follow-ups

* US-009: swap the PNG `InteractivePlot` inside live-script cells for
  `<PlotRenderer figure={…} />`.
* US-010: wire `plotly_click` to pin tooltips and add a "data cursor"
  toolbar toggle.
* US-011: a save-view button calling `Plotly.downloadImage`.
* US-012: a detach button opening the same component in a new window.
* Revisit bundle size once US-009 lands and we can measure the renderer
  build output; if the installer crosses a painful threshold, rebuild
  Plotly from source with only the trace types MatSlop actually uses.

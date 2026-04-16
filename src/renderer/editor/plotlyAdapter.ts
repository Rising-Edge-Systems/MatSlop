/**
 * Pure adapter converting a `PlotFigure` (MatSlop plot schema, see
 * `src/main/plotSchema.ts`) into Plotly.js `data` + `layout` + `config`
 * objects ready to hand to `Plotly.newPlot`.
 *
 * This module deliberately does not import `plotly.js-dist-min` — it only
 * produces plain objects in Plotly's trace shape. That keeps it unit-testable
 * without loading the 4.7 MB bundle, and means the `PlotRenderer` React
 * component stays a ~30-line shell.
 */

/** Strip keys with undefined values — Plotly crashes on explicit undefined. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

import type {
  PlotAxes,
  PlotFigure,
  PlotSeries,
  RGBColor,
  Vec2,
} from '../../main/plotSchema'

/** Loose alias so tests (and this file) don't pull in @types/plotly.js. */
export type PlotlyTrace = Record<string, unknown>
export type PlotlyLayout = Record<string, unknown>
export interface PlotlyConfig {
  responsive: boolean
  displaylogo: boolean
  modeBarButtonsToRemove?: string[]
  [key: string]: unknown
}

export interface PlotlyFigure {
  data: PlotlyTrace[]
  layout: PlotlyLayout
  config: PlotlyConfig
}

// --------------------------------------------------------------------------
// Color helpers
// --------------------------------------------------------------------------

/** Convert an RGBColor (0..1 components) to a CSS `rgb()` / `rgba()` string. */
export function rgbToCss(color: RGBColor | undefined): string | undefined {
  if (!color) return undefined
  const r = Math.round(clamp01(color[0]) * 255)
  const g = Math.round(clamp01(color[1]) * 255)
  const b = Math.round(clamp01(color[2]) * 255)
  if (color.length === 4) {
    const a = clamp01(color[3])
    return `rgba(${r},${g},${b},${a})`
  }
  return `rgb(${r},${g},${b})`
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function flatten2d(m: number[][]): number[] {
  const out: number[] = []
  for (const row of m) for (const v of row) out.push(v)
  return out
}

function dashFromLineStyle(ls: string | undefined): string | undefined {
  switch (ls) {
    case '-':
      return 'solid'
    case '--':
      return 'dash'
    case ':':
      return 'dot'
    case '-.':
      return 'dashdot'
    case 'none':
      return undefined
    default:
      return undefined
  }
}

/** Octave single-letter marker → Plotly symbol name. */
function markerSymbol(m: string | undefined): string | undefined {
  if (!m || m === 'none') return undefined
  switch (m) {
    case 'o':
      return 'circle'
    case '+':
      return 'cross'
    case '*':
      return 'asterisk'
    case '.':
      return 'circle-dot'
    case 'x':
      return 'x'
    case 's':
      return 'square'
    case 'd':
      return 'diamond'
    case '^':
      return 'triangle-up'
    case 'v':
      return 'triangle-down'
    case '>':
      return 'triangle-right'
    case '<':
      return 'triangle-left'
    case 'p':
      return 'star'
    case 'h':
      return 'hexagon'
    default:
      return m
  }
}

// --------------------------------------------------------------------------
// Series → trace
// --------------------------------------------------------------------------

function is3D(axes: PlotAxes): boolean {
  return axes.series.some(
    (s) =>
      s.type === 'line3' ||
      s.type === 'scatter3' ||
      s.type === 'surface' ||
      s.type === 'mesh' ||
      s.type === 'quiver3' ||
      s.type === 'bar3' ||
      s.type === 'contour3',
  )
}

function seriesToTraces(
  series: PlotSeries,
  axesIndex: number,
  axesIs3D: boolean,
  showColorbar: boolean,
): PlotlyTrace[] {
  const name = series.type === 'unknown' ? undefined : series.label
  const showlegend = typeof name === 'string' && name.length > 0
  const sceneKey = axesIndex === 0 ? 'scene' : `scene${axesIndex + 1}`
  const xaxisKey = axesIndex === 0 ? 'x' : `x${axesIndex + 1}`
  const yaxisKey = axesIndex === 0 ? 'y' : `y${axesIndex + 1}`

  switch (series.type) {
    case 'line': {
      const lineColor = rgbToCss(series.color)
      const dash = dashFromLineStyle(series.lineStyle)
      const hasMarker = series.marker && series.marker !== 'none'
      const hasLine = series.lineStyle !== 'none'
      return [
        clean({
          type: 'scatter',
          mode: hasLine && hasMarker ? 'lines+markers' : hasMarker ? 'markers' : 'lines',
          x: series.x,
          y: series.y,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          line: lineColor || dash || series.lineWidth
            ? clean({ color: lineColor, dash, width: Math.max(series.lineWidth ?? 1.5, 1.5) })
            : undefined,
          marker: hasMarker
            ? clean({
                symbol: markerSymbol(series.marker),
                size: series.markerSize,
                color: rgbToCss(series.markerFaceColor) ?? lineColor,
                ...(series.markerEdgeColor
                  ? { line: { color: rgbToCss(series.markerEdgeColor) } }
                  : {}),
              })
            : undefined,
        }),
      ]
    }
    case 'line3': {
      const lineColor = rgbToCss(series.color)
      const dash = dashFromLineStyle(series.lineStyle)
      const hasMarker = series.marker && series.marker !== 'none'
      const hasLine = series.lineStyle !== 'none'
      return [
        {
          type: 'scatter3d',
          mode: hasLine && hasMarker ? 'lines+markers' : hasMarker ? 'markers' : 'lines',
          x: series.x,
          y: series.y,
          z: series.z,
          name,
          showlegend,
          scene: sceneKey,
          line: { color: lineColor, dash, width: series.lineWidth },
          marker: hasMarker
            ? { symbol: markerSymbol(series.marker), size: series.markerSize, color: lineColor }
            : undefined,
        },
      ]
    }
    case 'scatter': {
      const singleColor = Array.isArray(series.color) && typeof series.color[0] === 'number'
        ? rgbToCss(series.color as RGBColor)
        : undefined
      return [
        {
          type: 'scatter',
          mode: 'markers',
          x: series.x,
          y: series.y,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          marker: {
            symbol: markerSymbol(series.marker) ?? 'circle',
            size: series.size,
            color: singleColor,
          },
        },
      ]
    }
    case 'scatter3': {
      const singleColor = Array.isArray(series.color) && typeof series.color[0] === 'number'
        ? rgbToCss(series.color as RGBColor)
        : undefined
      return [
        {
          type: 'scatter3d',
          mode: 'markers',
          x: series.x,
          y: series.y,
          z: series.z,
          name,
          showlegend,
          scene: sceneKey,
          marker: {
            symbol: markerSymbol(series.marker) ?? 'circle',
            size: series.size,
            color: singleColor,
          },
        },
      ]
    }
    case 'surface':
    case 'mesh': {
      const wire = series.type === 'mesh'
      // Octave may store x/y as:
      //   - Row vector: [[1,2,...,N]] (1×N 2D) → flatten to 1D
      //   - Column vector: [[1],[2],...,[N]] (N×1 2D) → flatten to 1D
      //   - Full 2D grid: [[...],[...],...] (NxM) → keep as 2D (Plotly accepts it)
      const flatten2D = (arr: unknown): unknown => {
        if (!Array.isArray(arr) || !Array.isArray(arr[0])) return arr
        const rows = arr.length
        const cols = (arr[0] as unknown[]).length
        if (rows === 1) return arr[0]          // row vector → 1D
        if (cols === 1) return arr.map((r: unknown[]) => r[0])  // col vector → 1D
        return arr                              // full grid → keep 2D
      }
      const flatX = flatten2D(series.x)
      const flatY = flatten2D(series.y)
      return [
        clean({
          type: 'surface',
          x: flatX,
          y: flatY,
          z: series.z,
          surfacecolor: series.c,
          colorscale: 'Viridis',
          name,
          showlegend,
          scene: sceneKey,
          hidesurface: wire || series.faceColor === 'none',
          showscale: showColorbar,
          colorbar: showColorbar
            ? { thickness: 15, len: 0.8, xpad: 4 }
            : undefined,
          contours: wire
            ? {
                x: { show: true, highlight: false },
                y: { show: true, highlight: false },
              }
            : undefined,
        }),
      ]
    }
    case 'quiver': {
      // Plotly has no native 2D quiver; emit line segments (one per arrow)
      // plus arrowhead markers. Not pretty, but visually correct and
      // avoids pulling plotly's figure-factory which requires the full
      // bundle.
      const xLines: (number | null)[] = []
      const yLines: (number | null)[] = []
      const xHeads: number[] = []
      const yHeads: number[] = []
      for (let i = 0; i < series.x.length; i++) {
        const x0 = series.x[i]
        const y0 = series.y[i]
        const x1 = x0 + series.u[i]
        const y1 = y0 + series.v[i]
        xLines.push(x0, x1, null)
        yLines.push(y0, y1, null)
        xHeads.push(x1)
        yHeads.push(y1)
      }
      const color = rgbToCss(series.color)
      return [
        {
          type: 'scatter',
          mode: 'lines',
          x: xLines,
          y: yLines,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          line: { color, width: series.lineWidth },
        },
        {
          type: 'scatter',
          mode: 'markers',
          x: xHeads,
          y: yHeads,
          showlegend: false,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          marker: { symbol: 'triangle-up', size: 6, color },
        },
      ]
    }
    case 'quiver3': {
      return [
        {
          type: 'cone',
          x: series.x,
          y: series.y,
          z: series.z ?? series.x.map(() => 0),
          u: series.u,
          v: series.v,
          w: series.w ?? series.u.map(() => 0),
          name,
          showlegend,
          scene: sceneKey,
          showscale: false,
          sizemode: 'absolute',
        },
      ]
    }
    case 'bar': {
      const y = Array.isArray(series.y[0]) ? flatten2d(series.y as number[][]) : (series.y as number[])
      return [
        {
          type: 'bar',
          x: series.x,
          y,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          marker: { color: rgbToCss(series.color) },
          width: series.barWidth,
        },
      ]
    }
    case 'bar3': {
      // No native bar3 in Plotly — render as mesh3d cuboids is overkill,
      // so emit a scatter3d-with-bars fallback: one vertical line per bar.
      const xs: number[] = []
      const ys: number[] = []
      const zs: (number | null)[] = []
      if (Array.isArray(series.y[0])) {
        const matrix = series.y as number[][]
        for (let i = 0; i < matrix.length; i++) {
          for (let j = 0; j < matrix[i].length; j++) {
            xs.push(series.x[i], series.x[i])
            ys.push(j, j)
            zs.push(0, matrix[i][j])
          }
        }
      } else {
        const flat = series.y as number[]
        for (let i = 0; i < flat.length; i++) {
          xs.push(series.x[i], series.x[i])
          ys.push(0, 0)
          zs.push(0, flat[i])
        }
      }
      return [
        {
          type: 'scatter3d',
          mode: 'lines',
          x: xs,
          y: ys,
          z: zs,
          name,
          showlegend,
          scene: sceneKey,
          line: { color: rgbToCss(series.color), width: 8 },
        },
      ]
    }
    case 'contour': {
      return [
        {
          type: 'contour',
          x: series.x[0],
          y: series.y.map((row) => row[0]),
          z: series.z,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          contours: {
            coloring: series.filled ? 'fill' : 'lines',
            ...(series.levels && series.levels.length > 0
              ? { start: series.levels[0], end: series.levels[series.levels.length - 1] }
              : {}),
          },
          line: { width: series.lineWidth },
        },
      ]
    }
    case 'contour3': {
      return [
        {
          type: 'surface',
          x: series.x,
          y: series.y,
          z: series.z,
          name,
          showlegend,
          scene: sceneKey,
          showscale: false,
          contours: {
            z: { show: true, usecolormap: true, highlightcolor: '#42f462', project: { z: true } },
          },
        },
      ]
    }
    case 'image': {
      return [
        {
          type: 'heatmap',
          z: series.data,
          x0: series.xLimits[0],
          dx: series.data[0] && series.data[0].length > 1
            ? (series.xLimits[1] - series.xLimits[0]) / (series.data[0].length - 1)
            : 1,
          y0: series.yLimits[0],
          dy: series.data.length > 1
            ? (series.yLimits[1] - series.yLimits[0]) / (series.data.length - 1)
            : 1,
          name,
          showlegend,
          xaxis: xaxisKey,
          yaxis: yaxisKey,
          colorscale: series.colormap === 'jet' ? 'Jet' : 'Viridis',
          showscale: true,
        },
      ]
    }
    case 'unknown':
      return []
    default: {
      const _exhaustive: never = series
      void _exhaustive
      return []
    }
  }

  void axesIs3D
}

// --------------------------------------------------------------------------
// Axes → layout
// --------------------------------------------------------------------------

function axesToLayoutKeys(axes: PlotAxes, axesIndex: number, layout: PlotlyLayout): void {
  const threeD = is3D(axes)
  const domain = axes.position
    ? {
        x: [axes.position[0], axes.position[0] + axes.position[2]],
        y: [axes.position[1], axes.position[1] + axes.position[3]],
      }
    : undefined

  if (threeD) {
    const sceneKey = axesIndex === 0 ? 'scene' : `scene${axesIndex + 1}`
    const scene: Record<string, unknown> = {
      xaxis: {
        title: axes.xLabel ? { text: axes.xLabel } : undefined,
        range: axes.xLimits,
        type: axes.xScale,
      },
      yaxis: {
        title: axes.yLabel ? { text: axes.yLabel } : undefined,
        range: axes.yLimits,
        type: axes.yScale,
      },
      zaxis: {
        title: axes.zLabel ? { text: axes.zLabel } : undefined,
        range: axes.zLimits,
        type: axes.zScale,
      },
      bgcolor: rgbToCss(axes.backgroundColor),
      // MATLAB-like 3D controls: turntable keeps z-axis pointing up
      // (like MATLAB's rotate3d azimuth/elevation model, not a free trackball)
      dragmode: 'turntable',
      aspectmode: 'cube' as const,
    }
    scene.camera = {
      // Orthographic projection: no perspective distortion, parallel lines
      // stay parallel — the default for scientific/engineering plots in MATLAB
      projection: { type: 'orthographic' },
      // Lock z as the up-vector (MATLAB convention)
      up: { x: 0, y: 0, z: 1 },
      center: { x: 0, y: 0, z: 0 },
      ...(axes.view ? cameraFromView(axes.view) : { eye: { x: 1.5, y: 1.5, z: 1.5 } }),
    }
    if (domain) {
      scene.domain = domain
    }
    layout[sceneKey] = scene
  } else {
    const xaxisKey = axesIndex === 0 ? 'xaxis' : `xaxis${axesIndex + 1}`
    const yaxisKey = axesIndex === 0 ? 'yaxis' : `yaxis${axesIndex + 1}`
    layout[xaxisKey] = {
      title: axes.xLabel ? { text: axes.xLabel } : undefined,
      range: axes.xLimits,
      type: axes.xScale,
      showgrid: axes.grid,
      zeroline: true,
      zerolinecolor: '#888',
      zerolinewidth: 1,
      showline: true,
      linecolor: '#888',
      linewidth: 1,
      mirror: true,
      domain: domain?.x,
      anchor: axesIndex === 0 ? 'y' : `y${axesIndex + 1}`,
    }
    layout[yaxisKey] = {
      title: axes.yLabel ? { text: axes.yLabel } : undefined,
      range: axes.yLimits,
      type: axes.yScale,
      showgrid: axes.grid,
      zeroline: true,
      zerolinecolor: '#888',
      zerolinewidth: 1,
      showline: true,
      linecolor: '#888',
      linewidth: 1,
      mirror: true,
      domain: domain?.y,
      scaleanchor: axes.aspectRatio === 'equal' ? (axesIndex === 0 ? 'x' : `x${axesIndex + 1}`) : undefined,
      anchor: axesIndex === 0 ? 'x' : `x${axesIndex + 1}`,
    }
  }

  // Title + legend live on the first axes' "annotations"/layout.title for
  // MATLAB-parity (there is one title per axes, not per figure). We fold
  // them into annotations for non-first axes and into layout.title for
  // the first.
  if (axesIndex === 0 && axes.title) {
    layout.title = { text: axes.title }
  }
  if (axes.legend?.visible && axesIndex === 0) {
    layout.showlegend = true
  }
}

function cameraFromView(view: Vec2): Record<string, unknown> {
  // Convert [azimuth, elevation] (degrees) to Plotly camera.eye on the
  // unit sphere at radius ~2.5 (Plotly's default "1.25" is too close for
  // scientific plots with axis cubes).
  const azRad = (view[0] * Math.PI) / 180
  const elRad = (view[1] * Math.PI) / 180
  const r = 2.5
  return {
    eye: {
      x: r * Math.cos(elRad) * Math.sin(azRad),
      y: -r * Math.cos(elRad) * Math.cos(azRad),
      z: r * Math.sin(elRad),
    },
  }
}

// --------------------------------------------------------------------------
// Data cursor (US-010)
// --------------------------------------------------------------------------

/**
 * Format a numeric coordinate for a data-cursor tooltip. Uses 4 significant
 * digits for non-integer values and trims trailing zeros. Pure — safe for
 * unit tests.
 */
export function formatCoord(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value as number)) {
    return '—'
  }
  const n = value as number
  if (Number.isInteger(n) && Math.abs(n) < 1e6) return String(n)
  const abs = Math.abs(n)
  // Use scientific for very small / very large
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) {
    return n.toExponential(3)
  }
  // Trim trailing zeros on a 4-sig-digit fixed representation.
  const s = n.toPrecision(4)
  // toPrecision may return e.g. "1.500" → trim; or "1.500e+3" → leave.
  if (s.includes('e') || s.includes('E')) return s
  if (s.includes('.')) return s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

/**
 * Build the label text for a data-cursor annotation pinned on a plot point.
 * For 2D points returns "x: 1.5\ny: 3.2"; for 3D points includes z.
 */
export function formatCursorLabel(point: {
  x?: number | null
  y?: number | null
  z?: number | null
}): string {
  const parts = [`x: ${formatCoord(point.x)}`, `y: ${formatCoord(point.y)}`]
  if (point.z !== undefined && point.z !== null) {
    parts.push(`z: ${formatCoord(point.z)}`)
  }
  return parts.join('<br>')
}

// --------------------------------------------------------------------------
// Export helpers (US-011)
// --------------------------------------------------------------------------

/**
 * Sanitize a string for use as a filesystem filename. Replaces runs of
 * characters that are illegal or awkward on any OS with underscores, trims
 * whitespace/dots, and caps length. Pure.
 */
export function sanitizeFilenameStem(name: string): string {
  // Replace any char not in the safe set with '_', then collapse runs.
  const cleaned = name
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .trim()
    .replace(/^[._]+|[._\s]+$/g, '')
  return cleaned.slice(0, 80)
}

/**
 * Derive a default export filename stem (no extension) from a figure.
 * Priority: figure.name → first non-empty axes[*].title → `figure-<handle>` →
 * `figure`. Used by the export button so saves start with a meaningful name.
 */
export function defaultExportFilename(figure: PlotFigure): string {
  const candidates: string[] = []
  if (figure.name && figure.name.trim().length > 0) {
    candidates.push(figure.name.trim())
  }
  for (const ax of figure.axes) {
    const t = (ax.title ?? '').trim()
    if (t.length > 0) candidates.push(t)
  }
  if (typeof figure.handle === 'number' && Number.isFinite(figure.handle)) {
    candidates.push(`figure-${figure.handle}`)
  }
  candidates.push('figure')
  for (const c of candidates) {
    const sanitized = sanitizeFilenameStem(c)
    if (sanitized.length > 0) return sanitized
  }
  return 'figure'
}

// --------------------------------------------------------------------------
// Public entrypoint
// --------------------------------------------------------------------------

/**
 * Convert a parsed `PlotFigure` into a Plotly `{ data, layout, config }`
 * ready for `Plotly.newPlot(div, data, layout, config)`.
 *
 * Pure function — no DOM access, no Plotly runtime import. Safe to unit
 * test in node.
 */
export function figureToPlotly(figure: PlotFigure): PlotlyFigure {
  const data: PlotlyTrace[] = []
  const has3DAxes = figure.axes.some(is3D)
  const layout: PlotlyLayout = {
    autosize: true,
    margin: has3DAxes
      ? { l: 0, r: 0, t: figure.axes[0]?.title ? 30 : 0, b: 0 }
      : { l: 50, r: 20, t: figure.axes[0]?.title ? 40 : 20, b: 50 },
    // 3D plots: transparent paper so the WebGL scene blends with the panel
    // background instead of showing white bars around the scene viewport.
    paper_bgcolor: has3DAxes ? 'rgba(0,0,0,0)' : rgbToCss(figure.backgroundColor),
    plot_bgcolor: rgbToCss(figure.axes[0]?.backgroundColor),
    showlegend: false,
    hovermode: 'closest',
    // MATLAB-like: drag to pan, scroll to zoom, double-click to reset
    dragmode: 'pan',
    annotations: [],
  }

  figure.axes.forEach((axes, i) => {
    axesToLayoutKeys(axes, i, layout)
    for (const s of axes.series) {
      for (const trace of seriesToTraces(s, i, is3D(axes), axes.colorbar === true)) {
        data.push(trace)
      }
    }
  })

  // Show legend if any trace has a name (auto-detect since matslop_export_fig
  // doesn't export legend visibility yet)
  if (data.some((t) => t.showlegend)) {
    layout.showlegend = true
  }

  const config: PlotlyConfig = {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,  // scroll wheel to zoom
    modeBarButtonsToRemove: [
      'sendDataToCloud', 'lasso2d', 'select2d',
      'toggleSpikelines', 'hoverCompareCartesian',
      'hoverClosestCartesian',
    ],
  }

  return { data, layout, config }
}

/**
 * MatSlop Plot Schema
 *
 * JSON representation of an Octave figure exported by the bundled
 * `matslop_export_fig(h)` Octave function (see resources/octave-scripts).
 *
 * The Octave function walks a figure handle and emits a JSON string
 * matching this schema. A JavaScript plot library (e.g. Plotly.js, in a
 * later user story) can then re-render the figure interactively.
 *
 * The goal of this schema is to:
 *   1. Cover the Octave plot types listed in the roadmap:
 *      plot, plot3, scatter, scatter3, surf, mesh,
 *      quiver, quiver3, bar, bar3, contour, contour3, imagesc.
 *   2. Preserve axes labels, colors, view angles, and limits so the
 *      JS renderer can reconstruct the figure faithfully.
 *   3. Degrade gracefully — unknown fields are ignored on parse and
 *      unsupported series types are surfaced as `{ type: 'unknown' }`.
 */

export const PLOT_SCHEMA_VERSION = 1

/** An (x, y, z) triple or (x, y) pair used for view angles, light positions, etc. */
export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

/** RGB or RGBA color. Values are 0..1 to match Octave's get(h,'color'). */
export type RGBColor = [number, number, number] | [number, number, number, number]

/** One 2D line plotted as x vs. y. Covers `plot` and the 2D half of `scatter`. */
export interface LineSeries {
  type: 'line'
  /** Display label (used in legend). */
  label?: string
  /** X data, length N. */
  x: number[]
  /** Y data, length N. */
  y: number[]
  color?: RGBColor
  /** Octave linestyle: '-', '--', ':', '-.', or 'none'. */
  lineStyle?: '-' | '--' | ':' | '-.' | 'none'
  /** Line width in pixels. */
  lineWidth?: number
  /** Marker shape: 'o', '+', '*', '.', 'x', 's', 'd', '^', 'v', '>', '<', 'p', 'h', or 'none'. */
  marker?: string
  markerSize?: number
  markerFaceColor?: RGBColor
  markerEdgeColor?: RGBColor
}

/** One 3D line (plot3) or 3D scatter (scatter3 when lineStyle='none'). */
export interface Line3Series {
  type: 'line3'
  label?: string
  x: number[]
  y: number[]
  z: number[]
  color?: RGBColor
  lineStyle?: '-' | '--' | ':' | '-.' | 'none'
  lineWidth?: number
  marker?: string
  markerSize?: number
}

/** Scatter (2D) with per-point sizes/colors (what `scatter` produces). */
export interface ScatterSeries {
  type: 'scatter'
  label?: string
  x: number[]
  y: number[]
  /** Per-point marker size, or a single number applied to all points. */
  size?: number | number[]
  /** Per-point color, or a single RGB applied to all points. */
  color?: RGBColor | RGBColor[]
  marker?: string
}

export interface Scatter3Series {
  type: 'scatter3'
  label?: string
  x: number[]
  y: number[]
  z: number[]
  size?: number | number[]
  color?: RGBColor | RGBColor[]
  marker?: string
}

/** Surface (surf) / mesh. `type: 'surface'` is solid, `type: 'mesh'` is wireframe-only. */
export interface SurfaceSeries {
  type: 'surface' | 'mesh'
  label?: string
  /** X values, MxN grid (row-major). */
  x: number[][]
  /** Y values, MxN grid. */
  y: number[][]
  /** Z values, MxN grid. */
  z: number[][]
  /** Optional C (color) grid, MxN. */
  c?: number[][]
  /** Optional explicit edge color; if omitted, Octave default is used. */
  edgeColor?: RGBColor | 'none'
  faceColor?: RGBColor | 'none' | 'interp'
}

/** Quiver (2D) / quiver3 — vector field. */
export interface QuiverSeries {
  type: 'quiver' | 'quiver3'
  label?: string
  /** Tail positions. */
  x: number[]
  y: number[]
  z?: number[]
  /** Vector components. */
  u: number[]
  v: number[]
  w?: number[]
  color?: RGBColor
  lineWidth?: number
}

/** Bar chart (bar) or 3D bar (bar3). */
export interface BarSeries {
  type: 'bar' | 'bar3'
  label?: string
  /** Category positions. */
  x: number[]
  /** Heights. For `bar`, length N. For `bar3`, can be MxN matrix. */
  y: number[] | number[][]
  color?: RGBColor
  /** Bar width in data units (Octave default 0.8). */
  barWidth?: number
}

/** Contour plot (contour) or 3D contour (contour3). */
export interface ContourSeries {
  type: 'contour' | 'contour3'
  label?: string
  x: number[][]
  y: number[][]
  z: number[][]
  /** Contour levels. If omitted, the renderer picks defaults. */
  levels?: number[]
  /** Whether to render filled contours (`contourf`). */
  filled?: boolean
  lineWidth?: number
}

/** Imagesc — raster image. */
export interface ImageSeries {
  type: 'image'
  label?: string
  /** X extent: [xmin, xmax]. */
  xLimits: Vec2
  /** Y extent: [ymin, ymax]. */
  yLimits: Vec2
  /** 2D grid of data values (imagesc) — MxN row-major. */
  data: number[][]
  /** Optional colormap name (e.g. 'viridis', 'jet'). */
  colormap?: string
}

/** A series whose type is not recognized by the parser. Carries the raw tag so
 * the UI can surface a friendly "unsupported plot type" message (US-013). */
export interface UnknownSeries {
  type: 'unknown'
  /** Original Octave tag, e.g. 'patch', 'histogram'. */
  octaveType: string
  label?: string
}

export type PlotSeries =
  | LineSeries
  | Line3Series
  | ScatterSeries
  | Scatter3Series
  | SurfaceSeries
  | QuiverSeries
  | BarSeries
  | ContourSeries
  | ImageSeries
  | UnknownSeries

/** One axes object inside a figure. A figure can hold multiple (subplot). */
export interface PlotAxes {
  /** Title string. */
  title?: string
  xLabel?: string
  yLabel?: string
  zLabel?: string
  /** Axis limits. If omitted, renderer auto-scales. */
  xLimits?: Vec2
  yLimits?: Vec2
  zLimits?: Vec2
  /** Axis scales. Default 'linear'. */
  xScale?: 'linear' | 'log'
  yScale?: 'linear' | 'log'
  zScale?: 'linear' | 'log'
  /** View angles in degrees: [azimuth, elevation]. 3D only. */
  view?: Vec2
  /** Whether the grid is visible. */
  grid?: boolean
  /** Whether the axes box is drawn. */
  box?: boolean
  /** Aspect ratio mode. */
  aspectRatio?: 'auto' | 'equal' | 'manual'
  /** Position within the figure, normalized [left, bottom, width, height]. */
  position?: [number, number, number, number]
  /** Background color. */
  backgroundColor?: RGBColor
  /** Legend location/visibility. */
  legend?: { visible: boolean; location?: string; entries?: string[] }
  /** Whether the Octave figure had an explicit colorbar. */
  colorbar?: boolean
  /** Series drawn on this axes. */
  series: PlotSeries[]
}

export interface PlotFigure {
  /** Schema version; bump when breaking changes occur. */
  schemaVersion: number
  /** Octave figure handle (numeric). */
  handle: number
  /** Figure title (from Name/NumberTitle). */
  name?: string
  /** Figure background color. */
  backgroundColor?: RGBColor
  /** Figure size [width, height] in pixels. */
  size?: Vec2
  /** All axes belonging to the figure. */
  axes: PlotAxes[]
  /** Figure colormap as Plotly colorscale stops: [[position, [r,g,b]], ...] */
  colormap?: [number, number[]][]
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

/** Error thrown by parsePlotFigure when the input is fundamentally malformed. */
export class PlotSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlotSchemaError'
  }
}

const SUPPORTED_SERIES_TYPES = new Set<PlotSeries['type']>([
  'line',
  'line3',
  'scatter',
  'scatter3',
  'surface',
  'mesh',
  'quiver',
  'quiver3',
  'bar',
  'bar3',
  'contour',
  'contour3',
  'image',
  'unknown',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number')
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(isNumberArray)
}

function parseVec2(value: unknown): Vec2 | undefined {
  if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number')) {
    return [value[0] as number, value[1] as number]
  }
  return undefined
}

function parseColor(value: unknown): RGBColor | undefined {
  if (!Array.isArray(value)) return undefined
  if ((value.length === 3 || value.length === 4) && value.every((v) => typeof v === 'number')) {
    return value as RGBColor
  }
  return undefined
}

function parseSeries(raw: unknown): PlotSeries {
  if (!isObject(raw)) {
    throw new PlotSchemaError('Series must be an object')
  }
  const type = raw.type
  if (typeof type !== 'string') {
    throw new PlotSchemaError('Series is missing "type"')
  }
  if (!SUPPORTED_SERIES_TYPES.has(type as PlotSeries['type'])) {
    return {
      type: 'unknown',
      octaveType: type,
      label: typeof raw.label === 'string' ? raw.label : undefined,
    }
  }

  const base = {
    label: typeof raw.label === 'string' ? raw.label : undefined,
  }

  switch (type) {
    case 'line': {
      if (!isNumberArray(raw.x) || !isNumberArray(raw.y)) {
        throw new PlotSchemaError('line series requires numeric x[] and y[]')
      }
      if (raw.x.length !== raw.y.length) {
        throw new PlotSchemaError('line series x and y must have the same length')
      }
      return {
        ...base,
        type: 'line',
        x: raw.x,
        y: raw.y,
        color: parseColor(raw.color),
        lineStyle: typeof raw.lineStyle === 'string' ? (raw.lineStyle as LineSeries['lineStyle']) : undefined,
        lineWidth: typeof raw.lineWidth === 'number' ? raw.lineWidth : undefined,
        marker: typeof raw.marker === 'string' ? raw.marker : undefined,
        markerSize: typeof raw.markerSize === 'number' ? raw.markerSize : undefined,
        markerFaceColor: parseColor(raw.markerFaceColor),
        markerEdgeColor: parseColor(raw.markerEdgeColor),
      }
    }
    case 'line3': {
      if (!isNumberArray(raw.x) || !isNumberArray(raw.y) || !isNumberArray(raw.z)) {
        throw new PlotSchemaError('line3 series requires numeric x[], y[], z[]')
      }
      if (raw.x.length !== raw.y.length || raw.y.length !== raw.z.length) {
        throw new PlotSchemaError('line3 series x/y/z must have the same length')
      }
      return {
        ...base,
        type: 'line3',
        x: raw.x,
        y: raw.y,
        z: raw.z,
        color: parseColor(raw.color),
        lineStyle: typeof raw.lineStyle === 'string' ? (raw.lineStyle as Line3Series['lineStyle']) : undefined,
        lineWidth: typeof raw.lineWidth === 'number' ? raw.lineWidth : undefined,
        marker: typeof raw.marker === 'string' ? raw.marker : undefined,
        markerSize: typeof raw.markerSize === 'number' ? raw.markerSize : undefined,
      }
    }
    case 'scatter':
    case 'scatter3': {
      if (!isNumberArray(raw.x) || !isNumberArray(raw.y)) {
        throw new PlotSchemaError(`${type} series requires numeric x[] and y[]`)
      }
      if (type === 'scatter3' && !isNumberArray(raw.z)) {
        throw new PlotSchemaError('scatter3 series requires numeric z[]')
      }
      const size =
        typeof raw.size === 'number'
          ? raw.size
          : isNumberArray(raw.size)
          ? raw.size
          : undefined
      const color = Array.isArray(raw.color)
        ? parseColor(raw.color) ?? (Array.isArray((raw.color as unknown[])[0]) ? (raw.color as RGBColor[]) : undefined)
        : undefined
      if (type === 'scatter') {
        return { ...base, type: 'scatter', x: raw.x, y: raw.y, size, color, marker: typeof raw.marker === 'string' ? raw.marker : undefined }
      }
      return {
        ...base,
        type: 'scatter3',
        x: raw.x,
        y: raw.y,
        z: raw.z as number[],
        size,
        color,
        marker: typeof raw.marker === 'string' ? raw.marker : undefined,
      }
    }
    case 'surface':
    case 'mesh': {
      if (!isNumberMatrix(raw.x) || !isNumberMatrix(raw.y) || !isNumberMatrix(raw.z)) {
        throw new PlotSchemaError(`${type} series requires x/y/z matrices`)
      }
      return {
        ...base,
        type,
        x: raw.x,
        y: raw.y,
        z: raw.z,
        c: isNumberMatrix(raw.c) ? raw.c : undefined,
        edgeColor:
          raw.edgeColor === 'none' ? 'none' : parseColor(raw.edgeColor),
        faceColor:
          raw.faceColor === 'none' || raw.faceColor === 'interp'
            ? raw.faceColor
            : parseColor(raw.faceColor),
      }
    }
    case 'quiver':
    case 'quiver3': {
      if (!isNumberArray(raw.x) || !isNumberArray(raw.y) || !isNumberArray(raw.u) || !isNumberArray(raw.v)) {
        throw new PlotSchemaError(`${type} series requires x/y/u/v`)
      }
      if (type === 'quiver3' && (!isNumberArray(raw.z) || !isNumberArray(raw.w))) {
        throw new PlotSchemaError('quiver3 series requires z[] and w[]')
      }
      return {
        ...base,
        type,
        x: raw.x,
        y: raw.y,
        z: isNumberArray(raw.z) ? raw.z : undefined,
        u: raw.u,
        v: raw.v,
        w: isNumberArray(raw.w) ? raw.w : undefined,
        color: parseColor(raw.color),
        lineWidth: typeof raw.lineWidth === 'number' ? raw.lineWidth : undefined,
      }
    }
    case 'bar':
    case 'bar3': {
      if (!isNumberArray(raw.x)) {
        throw new PlotSchemaError(`${type} series requires numeric x[]`)
      }
      const y = isNumberArray(raw.y) ? raw.y : isNumberMatrix(raw.y) ? raw.y : undefined
      if (!y) throw new PlotSchemaError(`${type} series requires numeric y[]`)
      return {
        ...base,
        type,
        x: raw.x,
        y,
        color: parseColor(raw.color),
        barWidth: typeof raw.barWidth === 'number' ? raw.barWidth : undefined,
      }
    }
    case 'contour':
    case 'contour3': {
      if (!isNumberMatrix(raw.x) || !isNumberMatrix(raw.y) || !isNumberMatrix(raw.z)) {
        throw new PlotSchemaError(`${type} series requires x/y/z matrices`)
      }
      return {
        ...base,
        type,
        x: raw.x,
        y: raw.y,
        z: raw.z,
        levels: isNumberArray(raw.levels) ? raw.levels : undefined,
        filled: typeof raw.filled === 'boolean' ? raw.filled : undefined,
        lineWidth: typeof raw.lineWidth === 'number' ? raw.lineWidth : undefined,
      }
    }
    case 'image': {
      const xLimits = parseVec2(raw.xLimits)
      const yLimits = parseVec2(raw.yLimits)
      if (!xLimits || !yLimits) {
        throw new PlotSchemaError('image series requires xLimits and yLimits')
      }
      if (!isNumberMatrix(raw.data)) {
        throw new PlotSchemaError('image series requires a 2D data matrix')
      }
      return {
        ...base,
        type: 'image',
        xLimits,
        yLimits,
        data: raw.data,
        colormap: typeof raw.colormap === 'string' ? raw.colormap : undefined,
      }
    }
    case 'unknown': {
      return {
        type: 'unknown',
        octaveType: typeof raw.octaveType === 'string' ? raw.octaveType : 'unknown',
        label: base.label,
      }
    }
  }

  // Unreachable — exhaustive switch above.
  throw new PlotSchemaError(`Unhandled series type: ${type}`)
}

function parseAxes(raw: unknown): PlotAxes {
  if (!isObject(raw)) {
    throw new PlotSchemaError('Axes must be an object')
  }
  const seriesRaw = Array.isArray(raw.series) ? raw.series : []
  const legend =
    isObject(raw.legend) && typeof raw.legend.visible === 'boolean'
      ? {
          visible: raw.legend.visible,
          location: typeof raw.legend.location === 'string' ? raw.legend.location : undefined,
          entries: Array.isArray(raw.legend.entries)
            ? (raw.legend.entries.filter((e) => typeof e === 'string') as string[])
            : undefined,
        }
      : undefined
  const position = Array.isArray(raw.position) && raw.position.length === 4 && raw.position.every((v) => typeof v === 'number')
    ? (raw.position as [number, number, number, number])
    : undefined

  return {
    title: typeof raw.title === 'string' ? raw.title : undefined,
    xLabel: typeof raw.xLabel === 'string' ? raw.xLabel : undefined,
    yLabel: typeof raw.yLabel === 'string' ? raw.yLabel : undefined,
    zLabel: typeof raw.zLabel === 'string' ? raw.zLabel : undefined,
    xLimits: parseVec2(raw.xLimits),
    yLimits: parseVec2(raw.yLimits),
    zLimits: parseVec2(raw.zLimits),
    xScale: raw.xScale === 'log' ? 'log' : raw.xScale === 'linear' ? 'linear' : undefined,
    yScale: raw.yScale === 'log' ? 'log' : raw.yScale === 'linear' ? 'linear' : undefined,
    zScale: raw.zScale === 'log' ? 'log' : raw.zScale === 'linear' ? 'linear' : undefined,
    view: parseVec2(raw.view),
    grid: typeof raw.grid === 'boolean' ? raw.grid : undefined,
    box: typeof raw.box === 'boolean' ? raw.box : undefined,
    aspectRatio:
      raw.aspectRatio === 'auto' || raw.aspectRatio === 'equal' || raw.aspectRatio === 'manual'
        ? raw.aspectRatio
        : undefined,
    position,
    backgroundColor: parseColor(raw.backgroundColor),
    legend,
    colorbar: typeof raw.colorbar === 'boolean' ? raw.colorbar : undefined,
    series: seriesRaw.map(parseSeries),
  }
}

/**
 * Parse & validate a JSON string (or already-parsed object) emitted by
 * `matslop_export_fig`. Throws {@link PlotSchemaError} on malformed input.
 */
export function parsePlotFigure(input: string | unknown): PlotFigure {
  const raw: unknown = typeof input === 'string' ? safeJsonParse(input) : input
  if (!isObject(raw)) {
    throw new PlotSchemaError('Figure must be an object')
  }
  const handle = typeof raw.handle === 'number' ? raw.handle : null
  if (handle === null) {
    throw new PlotSchemaError('Figure is missing numeric "handle"')
  }
  const axesRaw = Array.isArray(raw.axes) ? raw.axes : []
  // Parse colormap: array of [position, [r,g,b]] stops
  let colormap: [number, number[]][] | undefined
  if (Array.isArray(raw.colormap)) {
    try {
      colormap = (raw.colormap as unknown[]).map((stop) => {
        const arr = stop as [number, number[]]
        return [Number(arr[0]), (arr[1] as number[]).map(Number)] as [number, number[]]
      })
    } catch {
      colormap = undefined
    }
  }

  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : PLOT_SCHEMA_VERSION,
    handle,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    backgroundColor: parseColor(raw.backgroundColor),
    size: parseVec2(raw.size),
    axes: axesRaw.map(parseAxes),
    colormap,
  }
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch (err) {
    throw new PlotSchemaError(
      `Figure JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

import { describe, it, expect } from 'vitest'
import {
  parsePlotFigure,
  PlotSchemaError,
  PLOT_SCHEMA_VERSION,
  type PlotFigure,
  type LineSeries,
  type Line3Series,
  type SurfaceSeries,
  type QuiverSeries,
  type BarSeries,
  type ContourSeries,
  type ImageSeries,
  type Scatter3Series,
  type UnknownSeries,
} from '../../src/main/plotSchema'

// --------------------------------------------------------------------------
// Sample fixtures — these imitate the JSON that the bundled Octave
// `matslop_export_fig(h)` function emits for each supported plot type.
// They are kept inline so any future schema change shows up as a diff in
// this file and can be reviewed alongside the TypeScript changes.
// --------------------------------------------------------------------------

function makeLineFigure(): unknown {
  return {
    schemaVersion: PLOT_SCHEMA_VERSION,
    handle: 1,
    name: 'sine wave',
    backgroundColor: [1, 1, 1],
    size: [640, 480],
    axes: [
      {
        title: 'sin(x)',
        xLabel: 'x',
        yLabel: 'y',
        xLimits: [0, 6.283],
        yLimits: [-1, 1],
        xScale: 'linear',
        yScale: 'linear',
        grid: true,
        box: true,
        position: [0.13, 0.11, 0.775, 0.815],
        series: [
          {
            type: 'line',
            label: 'sin',
            x: [0, 1, 2, 3],
            y: [0, 0.84, 0.91, 0.14],
            color: [0, 0.447, 0.741],
            lineStyle: '-',
            lineWidth: 1.5,
            marker: 'none',
          },
        ],
      },
    ],
  }
}

function makeSurfFigure(): unknown {
  return {
    handle: 2,
    axes: [
      {
        title: 'peaks',
        xLabel: 'x',
        yLabel: 'y',
        zLabel: 'z',
        xLimits: [-3, 3],
        yLimits: [-3, 3],
        zLimits: [-8, 8],
        view: [37.5, 30],
        series: [
          {
            type: 'surface',
            x: [
              [-3, 0, 3],
              [-3, 0, 3],
              [-3, 0, 3],
            ],
            y: [
              [-3, -3, -3],
              [0, 0, 0],
              [3, 3, 3],
            ],
            z: [
              [0.5, 0.1, 0.2],
              [0.1, 5.0, 0.1],
              [0.2, 0.1, 0.5],
            ],
            edgeColor: 'none',
            faceColor: 'interp',
          },
        ],
      },
    ],
  }
}

function makeQuiver3Figure(): unknown {
  return {
    handle: 3,
    axes: [
      {
        view: [45, 45],
        series: [
          {
            type: 'quiver3',
            x: [0, 1, 2],
            y: [0, 1, 2],
            z: [0, 0, 0],
            u: [1, 0.5, 0],
            v: [0, 0.5, 1],
            w: [0, 0.1, 0],
            color: [0, 0.5, 0],
            lineWidth: 1,
          },
        ],
      },
    ],
  }
}

// --------------------------------------------------------------------------

describe('parsePlotFigure', () => {
  it('parses a basic 2D line figure', () => {
    const fig = parsePlotFigure(makeLineFigure())
    expect(fig.handle).toBe(1)
    expect(fig.name).toBe('sine wave')
    expect(fig.size).toEqual([640, 480])
    expect(fig.axes).toHaveLength(1)
    const ax = fig.axes[0]
    expect(ax.title).toBe('sin(x)')
    expect(ax.xLimits).toEqual([0, 6.283])
    expect(ax.yLimits).toEqual([-1, 1])
    expect(ax.grid).toBe(true)
    expect(ax.series).toHaveLength(1)
    const line = ax.series[0] as LineSeries
    expect(line.type).toBe('line')
    expect(line.x).toEqual([0, 1, 2, 3])
    expect(line.y).toEqual([0, 0.84, 0.91, 0.14])
    expect(line.color).toEqual([0, 0.447, 0.741])
    expect(line.lineWidth).toBe(1.5)
  })

  it('accepts JSON string input and returns the same structure', () => {
    const json = JSON.stringify(makeLineFigure())
    const fig = parsePlotFigure(json)
    expect(fig.handle).toBe(1)
    expect(fig.axes[0].series[0].type).toBe('line')
  })

  it('parses a surface figure with view angles and grid matrices', () => {
    const fig = parsePlotFigure(makeSurfFigure())
    expect(fig.axes[0].view).toEqual([37.5, 30])
    expect(fig.axes[0].zLimits).toEqual([-8, 8])
    const surf = fig.axes[0].series[0] as SurfaceSeries
    expect(surf.type).toBe('surface')
    expect(surf.x).toHaveLength(3)
    expect(surf.x[0]).toHaveLength(3)
    expect(surf.z[1][1]).toBe(5.0)
    expect(surf.edgeColor).toBe('none')
    expect(surf.faceColor).toBe('interp')
  })

  it('parses a quiver3 vector field figure', () => {
    const fig = parsePlotFigure(makeQuiver3Figure())
    const q = fig.axes[0].series[0] as QuiverSeries
    expect(q.type).toBe('quiver3')
    expect(q.x).toEqual([0, 1, 2])
    expect(q.w).toEqual([0, 0.1, 0])
    expect(q.color).toEqual([0, 0.5, 0])
  })

  it('parses plot3 (line3) series', () => {
    const fig = parsePlotFigure({
      handle: 4,
      axes: [
        {
          view: [30, 30],
          series: [
            {
              type: 'line3',
              x: [0, 1, 2],
              y: [0, 2, 4],
              z: [0, 1, 8],
              color: [1, 0, 0],
              lineStyle: '--',
            },
          ],
        },
      ],
    })
    const l3 = fig.axes[0].series[0] as Line3Series
    expect(l3.type).toBe('line3')
    expect(l3.z).toEqual([0, 1, 8])
    expect(l3.lineStyle).toBe('--')
  })

  it('parses scatter and scatter3 series with per-point sizes', () => {
    const fig = parsePlotFigure({
      handle: 5,
      axes: [
        {
          series: [
            { type: 'scatter', x: [1, 2, 3], y: [4, 5, 6], size: [10, 20, 30], marker: 'o' },
            { type: 'scatter3', x: [1, 2], y: [3, 4], z: [5, 6], size: 15 },
          ],
        },
      ],
    })
    expect(fig.axes[0].series[0].type).toBe('scatter')
    const s3 = fig.axes[0].series[1] as Scatter3Series
    expect(s3.type).toBe('scatter3')
    expect(s3.size).toBe(15)
    expect(s3.z).toEqual([5, 6])
  })

  it('parses bar / bar3 / contour / contour3 / mesh series', () => {
    const fig = parsePlotFigure({
      handle: 6,
      axes: [
        {
          series: [
            { type: 'bar', x: [1, 2, 3], y: [10, 20, 15] },
            {
              type: 'bar3',
              x: [1, 2],
              y: [
                [5, 6],
                [7, 8],
              ],
            },
            {
              type: 'contour',
              x: [[0, 1]],
              y: [[0, 1]],
              z: [[1, 2]],
              levels: [0.5, 1.0, 1.5],
              filled: false,
            },
            {
              type: 'contour3',
              x: [[0, 1]],
              y: [[0, 1]],
              z: [[1, 2]],
            },
            {
              type: 'mesh',
              x: [[0, 1]],
              y: [[0, 1]],
              z: [[1, 2]],
            },
          ],
        },
      ],
    })
    const bar = fig.axes[0].series[0] as BarSeries
    expect(bar.type).toBe('bar')
    expect(bar.y).toEqual([10, 20, 15])
    const bar3 = fig.axes[0].series[1] as BarSeries
    expect(bar3.type).toBe('bar3')
    expect(Array.isArray((bar3.y as number[][])[0])).toBe(true)
    const c = fig.axes[0].series[2] as ContourSeries
    expect(c.levels).toEqual([0.5, 1.0, 1.5])
    expect(c.filled).toBe(false)
    expect(fig.axes[0].series[3].type).toBe('contour3')
    expect(fig.axes[0].series[4].type).toBe('mesh')
  })

  it('parses an imagesc (image) series', () => {
    const fig = parsePlotFigure({
      handle: 7,
      axes: [
        {
          series: [
            {
              type: 'image',
              xLimits: [0, 10],
              yLimits: [0, 5],
              data: [
                [0, 1, 2],
                [3, 4, 5],
              ],
              colormap: 'viridis',
            },
          ],
        },
      ],
    })
    const img = fig.axes[0].series[0] as ImageSeries
    expect(img.type).toBe('image')
    expect(img.xLimits).toEqual([0, 10])
    expect(img.data[1][2]).toBe(5)
    expect(img.colormap).toBe('viridis')
  })

  it('preserves legend, multi-axes (subplot), and axis scales', () => {
    const fig = parsePlotFigure({
      handle: 8,
      axes: [
        {
          title: 'top',
          xScale: 'log',
          yScale: 'log',
          legend: { visible: true, location: 'northeast', entries: ['a', 'b'] },
          series: [
            { type: 'line', x: [1, 10, 100], y: [1, 2, 3] },
            { type: 'line', x: [1, 10, 100], y: [3, 2, 1] },
          ],
        },
        {
          title: 'bottom',
          series: [{ type: 'line', x: [0, 1], y: [0, 1] }],
        },
      ],
    })
    expect(fig.axes).toHaveLength(2)
    expect(fig.axes[0].xScale).toBe('log')
    expect(fig.axes[0].legend?.entries).toEqual(['a', 'b'])
    expect(fig.axes[1].title).toBe('bottom')
  })

  it('downgrades unsupported series types to {type: "unknown"}', () => {
    const fig = parsePlotFigure({
      handle: 9,
      axes: [
        {
          series: [{ type: 'histogram', label: 'H' }],
        },
      ],
    })
    const u = fig.axes[0].series[0] as UnknownSeries
    expect(u.type).toBe('unknown')
    expect(u.octaveType).toBe('histogram')
    expect(u.label).toBe('H')
  })

  it('defaults schemaVersion to the current version when missing', () => {
    const fig = parsePlotFigure({ handle: 10, axes: [] })
    expect(fig.schemaVersion).toBe(PLOT_SCHEMA_VERSION)
    expect(fig.axes).toEqual([])
  })

  it('throws PlotSchemaError when handle is missing', () => {
    expect(() => parsePlotFigure({ axes: [] })).toThrow(PlotSchemaError)
  })

  it('throws PlotSchemaError on malformed JSON string', () => {
    expect(() => parsePlotFigure('{not json')).toThrow(PlotSchemaError)
  })

  it('throws PlotSchemaError when a line series has mismatched x/y lengths', () => {
    expect(() =>
      parsePlotFigure({
        handle: 11,
        axes: [
          {
            series: [{ type: 'line', x: [1, 2, 3], y: [1, 2] }],
          },
        ],
      }),
    ).toThrow(/same length/)
  })

  it('ignores unknown extra fields at the figure/axes level', () => {
    const fig: PlotFigure = parsePlotFigure({
      handle: 12,
      weirdExtra: 'ignore me',
      axes: [{ strange: true, series: [] }],
    })
    expect(fig.handle).toBe(12)
    expect(fig.axes).toHaveLength(1)
  })
})

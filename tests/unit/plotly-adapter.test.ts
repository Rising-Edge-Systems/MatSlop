import { describe, expect, it } from 'vitest'
import { figureToPlotly, rgbToCss } from '../../src/renderer/editor/plotlyAdapter'
import type { PlotFigure } from '../../src/main/plotSchema'

function fig(overrides: Partial<PlotFigure> = {}): PlotFigure {
  return {
    schemaVersion: 1,
    handle: 1,
    axes: [],
    ...overrides,
  }
}

describe('rgbToCss', () => {
  it('converts rgb 0..1 to css rgb()', () => {
    expect(rgbToCss([1, 0, 0])).toBe('rgb(255,0,0)')
    expect(rgbToCss([0, 1, 0])).toBe('rgb(0,255,0)')
    expect(rgbToCss([0, 0, 1])).toBe('rgb(0,0,255)')
  })
  it('converts rgba 0..1 to css rgba()', () => {
    expect(rgbToCss([1, 0.5, 0, 0.5])).toBe('rgba(255,128,0,0.5)')
  })
  it('clamps values out of [0,1]', () => {
    expect(rgbToCss([-1, 2, 0.5])).toBe('rgb(0,255,128)')
  })
  it('returns undefined for undefined input', () => {
    expect(rgbToCss(undefined)).toBeUndefined()
  })
})

describe('figureToPlotly', () => {
  it('returns empty data for empty figure', () => {
    const out = figureToPlotly(fig())
    expect(out.data).toEqual([])
    expect(out.layout).toBeDefined()
    expect(out.config.responsive).toBe(true)
    expect(out.config.displaylogo).toBe(false)
  })

  it('maps line series to 2D scatter trace', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            title: 'Line plot',
            xLabel: 'x',
            yLabel: 'y',
            series: [
              {
                type: 'line',
                label: 'sine',
                x: [0, 1, 2],
                y: [0, 1, 0],
                color: [1, 0, 0],
                lineStyle: '--',
                lineWidth: 2,
              },
            ],
          },
        ],
      }),
    )
    expect(out.data).toHaveLength(1)
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('scatter')
    expect(trace.mode).toBe('lines')
    expect(trace.x).toEqual([0, 1, 2])
    expect(trace.y).toEqual([0, 1, 0])
    expect(trace.name).toBe('sine')
    expect(trace.xaxis).toBe('x')
    expect(trace.yaxis).toBe('y')
    const line = trace.line as Record<string, unknown>
    expect(line.color).toBe('rgb(255,0,0)')
    expect(line.dash).toBe('dash')
    expect(line.width).toBe(2)
    const layout = out.layout as Record<string, unknown>
    expect((layout.title as Record<string, unknown>).text).toBe('Line plot')
    const xaxis = layout.xaxis as Record<string, unknown>
    expect((xaxis.title as Record<string, unknown>).text).toBe('x')
  })

  it('maps line+marker series to lines+markers mode', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'line',
                x: [0, 1],
                y: [0, 1],
                marker: 'o',
                markerSize: 6,
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.mode).toBe('lines+markers')
    const marker = trace.marker as Record<string, unknown>
    expect(marker.symbol).toBe('circle')
    expect(marker.size).toBe(6)
  })

  it('maps line3 to scatter3d and promotes axes to 3D scene', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            xLabel: 'x',
            yLabel: 'y',
            zLabel: 'z',
            view: [30, 45],
            series: [
              { type: 'line3', x: [0, 1], y: [0, 1], z: [0, 1], color: [0, 0, 1] },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('scatter3d')
    expect(trace.scene).toBe('scene')
    const layout = out.layout as Record<string, unknown>
    const scene = layout.scene as Record<string, unknown>
    expect(scene).toBeDefined()
    expect((scene.zaxis as Record<string, unknown>).title).toEqual({ text: 'z' })
    expect(scene.camera).toBeDefined()
    // No 2D xaxis should be emitted when only 3D series are present
    expect(layout.xaxis).toBeUndefined()
  })

  it('maps surface to plotly surface with scene key', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'surface',
                x: [[0, 1], [0, 1]],
                y: [[0, 0], [1, 1]],
                z: [[0, 1], [1, 2]],
                faceColor: 'interp',
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('surface')
    expect(trace.scene).toBe('scene')
    expect(trace.showscale).toBe(false)
  })

  it('maps mesh to a wireframe-hinted surface', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'mesh',
                x: [[0, 1], [0, 1]],
                y: [[0, 0], [1, 1]],
                z: [[0, 1], [1, 2]],
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('surface')
    expect(trace.hidesurface).toBe(true)
    expect(trace.contours).toBeDefined()
  })

  it('maps quiver to two scatter traces (lines + heads)', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              { type: 'quiver', x: [0, 1], y: [0, 1], u: [1, 0], v: [0, 1] },
            ],
          },
        ],
      }),
    )
    expect(out.data).toHaveLength(2)
    const lines = out.data[0] as Record<string, unknown>
    const heads = out.data[1] as Record<string, unknown>
    expect(lines.mode).toBe('lines')
    expect(heads.mode).toBe('markers')
    // Lines should have 3 entries per arrow (x0, x1, null)
    expect((lines.x as unknown[]).length).toBe(6)
    expect((heads.x as unknown[]).length).toBe(2)
  })

  it('maps quiver3 to cone trace', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'quiver3',
                x: [0],
                y: [0],
                z: [0],
                u: [1],
                v: [0],
                w: [0],
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('cone')
    expect(trace.sizemode).toBe('absolute')
  })

  it('maps bar to plotly bar', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              { type: 'bar', x: [1, 2, 3], y: [10, 20, 30], color: [0, 0.5, 1] },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('bar')
    expect(trace.x).toEqual([1, 2, 3])
    expect(trace.y).toEqual([10, 20, 30])
  })

  it('maps contour with filled flag', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'contour',
                x: [[0, 1], [0, 1]],
                y: [[0, 0], [1, 1]],
                z: [[0, 1], [1, 0]],
                filled: true,
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('contour')
    const contours = trace.contours as Record<string, unknown>
    expect(contours.coloring).toBe('fill')
  })

  it('maps imagesc (image series) to heatmap', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              {
                type: 'image',
                xLimits: [0, 10],
                yLimits: [0, 5],
                data: [
                  [1, 2, 3],
                  [4, 5, 6],
                ],
                colormap: 'jet',
              },
            ],
          },
        ],
      }),
    )
    const trace = out.data[0] as Record<string, unknown>
    expect(trace.type).toBe('heatmap')
    expect(trace.colorscale).toBe('Jet')
    expect(trace.dx).toBe(5)
    expect(trace.dy).toBe(5)
  })

  it('supports multiple axes (subplots)', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            position: [0, 0.5, 1, 0.5],
            series: [{ type: 'line', x: [0, 1], y: [0, 1] }],
          },
          {
            position: [0, 0, 1, 0.5],
            series: [{ type: 'line', x: [0, 1], y: [1, 0] }],
          },
        ],
      }),
    )
    expect(out.data).toHaveLength(2)
    const first = out.data[0] as Record<string, unknown>
    const second = out.data[1] as Record<string, unknown>
    expect(first.xaxis).toBe('x')
    expect(second.xaxis).toBe('x2')
    const layout = out.layout as Record<string, unknown>
    expect(layout.xaxis).toBeDefined()
    expect(layout.xaxis2).toBeDefined()
    expect(layout.yaxis).toBeDefined()
    expect(layout.yaxis2).toBeDefined()
  })

  it('drops unknown series from the trace list', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [
              { type: 'unknown', octaveType: 'patch' },
              { type: 'line', x: [0], y: [0] },
            ],
          },
        ],
      }),
    )
    expect(out.data).toHaveLength(1)
    expect((out.data[0] as Record<string, unknown>).type).toBe('scatter')
  })

  it('sets showlegend when any axes has a visible legend', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            legend: { visible: true },
            series: [{ type: 'line', label: 'A', x: [0], y: [0] }],
          },
        ],
      }),
    )
    const layout = out.layout as Record<string, unknown>
    expect(layout.showlegend).toBe(true)
  })

  it('keeps showlegend false when no legend flagged', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            series: [{ type: 'line', x: [0], y: [0] }],
          },
        ],
      }),
    )
    const layout = out.layout as Record<string, unknown>
    expect(layout.showlegend).toBe(false)
  })

  it('applies axis limits and scales', () => {
    const out = figureToPlotly(
      fig({
        axes: [
          {
            xLimits: [0, 10],
            yLimits: [-1, 1],
            xScale: 'log',
            series: [{ type: 'line', x: [1], y: [0] }],
          },
        ],
      }),
    )
    const layout = out.layout as Record<string, unknown>
    const xaxis = layout.xaxis as Record<string, unknown>
    expect(xaxis.range).toEqual([0, 10])
    expect(xaxis.type).toBe('log')
    const yaxis = layout.yaxis as Record<string, unknown>
    expect(yaxis.range).toEqual([-1, 1])
  })
})

import { describe, it, expect } from 'vitest'
import { parsePlotFigure } from '../../src/main/plotSchema'
import { figureToPlotly } from '../../src/renderer/editor/plotlyAdapter'

/**
 * US-009 end-to-end wiring test — validates that a JSON payload shaped like
 * what `matslop_export_fig` emits can be parsed and then converted by the
 * `figureToPlotly` adapter into data the `PlotRenderer` component consumes.
 *
 * The LiveScriptEditor pipeline is:
 *   matslop_export_fig → jsonText → parsePlotFigure → figureToPlotly → Plotly.react
 *
 * This test exercises the first three hops to guard against regressions in
 * the JSON shape that would silently fall back to the static PNG.
 */
describe('US-009 live-script interactive plot wiring', () => {
  it('parses a quiver3-style figure JSON and converts to a Plotly cone trace', () => {
    // Minimal figure JSON as matslop_export_fig might emit for quiver3.
    const jsonText = JSON.stringify({
      schemaVersion: 1,
      handle: 1,
      axes: [
        {
          series: [
            {
              type: 'quiver3',
              x: [0, 1],
              y: [0, 1],
              z: [0, 1],
              u: [1, 0],
              v: [0, 1],
              w: [1, 1],
            },
          ],
          view: [30, 60],
        },
      ],
    })
    const figure = parsePlotFigure(jsonText)
    expect(figure.axes).toHaveLength(1)
    expect(figure.axes[0].series[0].type).toBe('quiver3')

    const { data, layout } = figureToPlotly(figure)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0].type).toBe('cone')
    // Multi-axes would produce scene2 etc.; a single quiver3 axis uses scene.
    expect(layout.scene).toBeDefined()
  })

  it('parses a 2D line-plot figure JSON and converts to a Plotly scatter trace', () => {
    const jsonText = JSON.stringify({
      schemaVersion: 1,
      handle: 42,
      axes: [
        {
          series: [
            { type: 'line', x: [1, 2, 3], y: [4, 5, 6] },
          ],
          xlabel: 'x',
          ylabel: 'y',
        },
      ],
    })
    const figure = parsePlotFigure(jsonText)
    const { data, layout } = figureToPlotly(figure)
    expect(data[0].type).toBe('scatter')
    expect(data[0].x).toEqual([1, 2, 3])
    expect(data[0].y).toEqual([4, 5, 6])
    // Single-axes 2D path uses xaxis/yaxis.
    expect(layout.xaxis).toBeDefined()
    expect(layout.yaxis).toBeDefined()
  })

  it('rejects malformed JSON so the UI falls back to PNG rendering', () => {
    expect(() => parsePlotFigure('not-json')).toThrow()
    // Missing numeric handle is invalid — PlotRenderer would never mount.
    expect(() => parsePlotFigure('{}')).toThrow()
  })
})

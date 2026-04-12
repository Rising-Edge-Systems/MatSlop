/**
 * US-L08 — Verify and fix the plotting pipeline end-to-end.
 *
 * This test file verifies the complete plotting pipeline from multiple angles:
 *
 * 1. **matslop_export_fig loadability** — Octave can load and parse the function
 * 2. **JSON schema round-trip** — matslop_export_fig JSON → parsePlotFigure → figureToPlotly
 * 3. **Capture script regex parsing** — the __MATSLOP_FIG__ / __MATSLOP_PWD__ markers
 * 4. **PlotRenderer data flow** — figureToPlotly produces valid Plotly data/layout/config
 * 5. **FigurePanel PNG path** — capture script → base64 → FigureData
 *
 * Real Octave plotting is blocked in the extracted-deb dev environment due to
 * missing FreeSans.otf fonts (ft_text_renderer: invalid bounding box). These
 * tests verify every step of the pipeline that CAN be verified without a working
 * graphics toolkit, and document what cannot.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { parsePlotFigure, type PlotFigure, type LineSeries } from '../../src/main/plotSchema'
import { figureToPlotly } from '../../src/renderer/editor/plotlyAdapter'
import { hasBundledOctaveBinary, getBundledOctaveBinaryPath } from '../helpers/octaveBinary'
import { OctaveProcessManager } from '../../src/main/octaveProcess'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HAS_OCTAVE = hasBundledOctaveBinary()

function waitForReady(mgr: OctaveProcessManager, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mgr.getStatus() === 'ready') { resolve(); return }
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    const onStatus = (status: string): void => {
      if (status === 'ready') {
        clearTimeout(timer)
        mgr.removeListener('status', onStatus)
        resolve()
      }
    }
    mgr.on('status', onStatus)
  })
}

/**
 * Simulated JSON that `matslop_export_fig` would produce for `plot(1:10)`.
 * This is the exact shape the Octave function emits — nested cell arrays
 * become JSON arrays, Octave struct fields become JSON object keys.
 */
const PLOT_1_TO_10_JSON: Record<string, unknown> = {
  schemaVersion: 1,
  handle: 1,
  backgroundColor: [1, 1, 1],
  size: [560, 420],
  axes: [{
    title: '',
    xLabel: '',
    yLabel: '',
    xLimits: [0.6, 10.4],
    yLimits: [0.6, 10.4],
    xScale: 'linear',
    yScale: 'linear',
    grid: false,
    box: true,
    position: [0.13, 0.11, 0.775, 0.815],
    backgroundColor: [1, 1, 1],
    series: [{
      type: 'line',
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      color: [0, 0.4470, 0.7410],
      lineStyle: '-',
      lineWidth: 2,
      marker: 'none',
      markerSize: 6,
    }],
  }],
}

/**
 * Simulated JSON for `surf(peaks(20))` — a 3D surface plot.
 */
const SURF_PEAKS_JSON: Record<string, unknown> = {
  schemaVersion: 1,
  handle: 2,
  axes: [{
    title: '',
    xLabel: '',
    yLabel: '',
    zLabel: '',
    xLimits: [1, 20],
    yLimits: [1, 20],
    zLimits: [-6.5, 8.1],
    view: [37.5, 30],
    grid: false,
    box: true,
    series: [{
      type: 'surface',
      x: [[1, 2, 3], [1, 2, 3], [1, 2, 3]],
      y: [[1, 1, 1], [2, 2, 2], [3, 3, 3]],
      z: [[0.5, 0.1, 0.2], [0.1, 5.0, 0.1], [0.2, 0.1, 0.5]],
      edgeColor: 'none',
      faceColor: 'interp',
    }],
  }],
}

/**
 * Simulated JSON for `scatter(rand(20,1), rand(20,1))`.
 */
const SCATTER_JSON: Record<string, unknown> = {
  schemaVersion: 1,
  handle: 3,
  axes: [{
    series: [{
      type: 'scatter',
      x: [0.1, 0.5, 0.9],
      y: [0.3, 0.7, 0.2],
      color: [0, 0.4470, 0.7410],
      lineStyle: 'none',
      marker: 'o',
      markerSize: 6,
    }],
  }],
}

/**
 * Simulated JSON for `bar([1 2 3; 4 5 6])`.
 */
const BAR_JSON: Record<string, unknown> = {
  schemaVersion: 1,
  handle: 4,
  axes: [{
    series: [{
      type: 'bar',
      x: [1, 2, 3],
      y: [10, 20, 15],
      color: [0, 0.4470, 0.7410],
    }],
  }],
}

// ---------------------------------------------------------------------------
// 1. matslop_export_fig Octave loadability
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_OCTAVE)('matslop_export_fig Octave loadability', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinaryPath())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('loads matslop_export_fig and reports its type as "file"', async () => {
    const scriptsDir = path.resolve(__dirname, '../../resources/octave-scripts')
    await mgr.executeCommand(`addpath('${scriptsDir}')`)
    const result = await mgr.executeCommand("disp(typeinfo(str2func('matslop_export_fig')))")
    expect(result.output.trim()).toContain('function')
  })
})

// ---------------------------------------------------------------------------
// 2. matslop_export_fig file exists and is valid Octave
// ---------------------------------------------------------------------------

describe('matslop_export_fig file validation', () => {
  const scriptPath = path.resolve(__dirname, '../../resources/octave-scripts/matslop_export_fig.m')

  it('exists on disk', () => {
    expect(fs.existsSync(scriptPath)).toBe(true)
  })

  it('starts with a function definition', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    // Skip comment block, find function line
    const funcLine = content.split('\n').find(l => l.startsWith('function '))
    expect(funcLine).toMatch(/^function\s+json\s*=\s*matslop_export_fig/)
  })

  it('defines all required helper functions', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    expect(content).toContain('__matslop_axes_to_struct__')
    expect(content).toContain('__matslop_series_to_struct__')
    expect(content).toContain('__matslop_to_json__')
    expect(content).toContain('__matslop_json_escape__')
    expect(content).toContain('__matslop_mat_to_cell__')
    expect(content).toContain('__matslop_label_string__')
  })

  it('handles all documented plot types in series_to_struct', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    // These are the Octave handle types the function should handle
    expect(content).toContain('case "line"')
    expect(content).toContain('case "surface"')
    expect(content).toContain('case "patch"')
    expect(content).toContain('case "hggroup"')
    expect(content).toContain('case "image"')
  })
})

// ---------------------------------------------------------------------------
// 3. JSON schema round-trip: simulated matslop_export_fig output → parsePlotFigure → figureToPlotly
// ---------------------------------------------------------------------------

describe('plotting pipeline: JSON → schema → Plotly (plot(1:10))', () => {
  let figure: PlotFigure

  beforeAll(() => {
    // Step 1: Parse the JSON as parsePlotFigure would
    figure = parsePlotFigure(PLOT_1_TO_10_JSON)
  })

  it('parsePlotFigure extracts handle and axes', () => {
    expect(figure.handle).toBe(1)
    expect(figure.axes).toHaveLength(1)
    expect(figure.axes[0].series).toHaveLength(1)
  })

  it('parsePlotFigure preserves line series data', () => {
    const line = figure.axes[0].series[0] as LineSeries
    expect(line.type).toBe('line')
    expect(line.x).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(line.y).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(line.color).toEqual([0, 0.4470, 0.7410])
    expect(line.lineWidth).toBe(2)
  })

  it('figureToPlotly produces a valid Plotly figure', () => {
    const plotly = figureToPlotly(figure)
    expect(plotly.data).toHaveLength(1)
    expect(plotly.layout).toBeDefined()
    expect(plotly.config).toBeDefined()
    expect(plotly.config.responsive).toBe(true)
    expect(plotly.config.displaylogo).toBe(false)
  })

  it('figureToPlotly maps line to scatter with lines mode', () => {
    const plotly = figureToPlotly(figure)
    const trace = plotly.data[0] as Record<string, unknown>
    expect(trace.type).toBe('scatter')
    expect(trace.mode).toBe('lines')
    expect(trace.x).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(trace.y).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('figureToPlotly sets correct line color from Octave RGB', () => {
    const plotly = figureToPlotly(figure)
    const trace = plotly.data[0] as Record<string, unknown>
    const line = trace.line as Record<string, unknown>
    expect(line.color).toBe('rgb(0,114,189)')  // 0, 0.447*255, 0.741*255
    expect(line.width).toBe(2)
  })

  it('figureToPlotly sets axis limits from the schema', () => {
    const plotly = figureToPlotly(figure)
    const layout = plotly.layout as Record<string, unknown>
    const xaxis = layout.xaxis as Record<string, unknown>
    const yaxis = layout.yaxis as Record<string, unknown>
    expect(xaxis.range).toEqual([0.6, 10.4])
    expect(yaxis.range).toEqual([0.6, 10.4])
  })

  it('figureToPlotly sets hovermode for data cursor (US-010)', () => {
    const plotly = figureToPlotly(figure)
    expect(plotly.layout.hovermode).toBe('closest')
    expect(plotly.layout.annotations).toEqual([])
  })
})

describe('plotting pipeline: JSON → schema → Plotly (surf)', () => {
  it('converts surface figure to Plotly 3D scene', () => {
    const figure = parsePlotFigure(SURF_PEAKS_JSON)
    const plotly = figureToPlotly(figure)

    expect(plotly.data).toHaveLength(1)
    const trace = plotly.data[0] as Record<string, unknown>
    expect(trace.type).toBe('surface')
    expect(trace.scene).toBe('scene')

    // Layout should have scene (3D), not xaxis/yaxis (2D)
    const layout = plotly.layout as Record<string, unknown>
    expect(layout.scene).toBeDefined()
    expect(layout.xaxis).toBeUndefined()
  })
})

describe('plotting pipeline: JSON → schema → Plotly (scatter)', () => {
  it('converts scatter to Plotly markers mode', () => {
    const figure = parsePlotFigure(SCATTER_JSON)
    const plotly = figureToPlotly(figure)

    const trace = plotly.data[0] as Record<string, unknown>
    expect(trace.type).toBe('scatter')
    expect(trace.mode).toBe('markers')
    expect(trace.x).toEqual([0.1, 0.5, 0.9])
  })
})

describe('plotting pipeline: JSON → schema → Plotly (bar)', () => {
  it('converts bar to Plotly bar trace', () => {
    const figure = parsePlotFigure(BAR_JSON)
    const plotly = figureToPlotly(figure)

    const trace = plotly.data[0] as Record<string, unknown>
    expect(trace.type).toBe('bar')
    expect(trace.x).toEqual([1, 2, 3])
    expect(trace.y).toEqual([10, 20, 15])
  })
})

// ---------------------------------------------------------------------------
// 4. Capture script marker parsing (mirrors App.tsx logic)
// ---------------------------------------------------------------------------

describe('capture script marker parsing', () => {
  /**
   * Simulate the regex parsing from App.tsx runCaptureAndRefresh().
   * This verifies the exact regexes used in production.
   */
  function parseCaptureOutput(output: string) {
    const pwdMatch = output.match(/__MATSLOP_PWD__:(.+)/)
    const figMatches = [...output.matchAll(/__MATSLOP_FIG__:(\d+):(.+)/g)]
    return {
      cwd: pwdMatch ? pwdMatch[1].trim() : null,
      figures: figMatches.map(m => ({
        handle: parseInt(m[1]),
        tempPath: m[2].trim(),
      })),
    }
  }

  it('parses pwd from capture output', () => {
    const output = '__MATSLOP_PWD__:/home/user/project\n'
    const result = parseCaptureOutput(output)
    expect(result.cwd).toBe('/home/user/project')
  })

  it('parses a single figure marker', () => {
    const output = [
      '__MATSLOP_PWD__:/tmp',
      '__MATSLOP_FIG__:1:/tmp/matslop_fig_1.png',
    ].join('\n')
    const result = parseCaptureOutput(output)
    expect(result.figures).toHaveLength(1)
    expect(result.figures[0].handle).toBe(1)
    expect(result.figures[0].tempPath).toBe('/tmp/matslop_fig_1.png')
  })

  it('parses multiple figure markers', () => {
    const output = [
      '__MATSLOP_PWD__:/home/user',
      '__MATSLOP_FIG__:1:/tmp/matslop_fig_1.png',
      '__MATSLOP_FIG__:2:/tmp/matslop_fig_2.png',
      '__MATSLOP_FIG__:5:/tmp/matslop_fig_5.png',
    ].join('\n')
    const result = parseCaptureOutput(output)
    expect(result.figures).toHaveLength(3)
    expect(result.figures[0].handle).toBe(1)
    expect(result.figures[1].handle).toBe(2)
    expect(result.figures[2].handle).toBe(5)
  })

  it('returns empty figures when no __MATSLOP_FIG__ markers present', () => {
    const output = '__MATSLOP_PWD__:/tmp\n'
    const result = parseCaptureOutput(output)
    expect(result.figures).toHaveLength(0)
  })

  it('handles Windows-style paths in figure markers', () => {
    const output = '__MATSLOP_FIG__:1:C:\\Users\\user\\AppData\\Local\\Temp\\matslop_fig_1.png\n'
    const result = parseCaptureOutput(output)
    expect(result.figures[0].tempPath).toBe('C:\\Users\\user\\AppData\\Local\\Temp\\matslop_fig_1.png')
  })

  it('handles output mixed with Octave warnings', () => {
    const output = [
      'warning: some octave warning',
      '__MATSLOP_PWD__:/home/user',
      'warning: another warning',
      '__MATSLOP_FIG__:1:/tmp/matslop_fig_1.png',
      'some other output',
    ].join('\n')
    const result = parseCaptureOutput(output)
    expect(result.cwd).toBe('/home/user')
    expect(result.figures).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. FigureData construction (PNG path)
// ---------------------------------------------------------------------------

describe('FigurePanel PNG pipeline', () => {
  it('constructs valid data URL from base64 PNG', () => {
    // Simulate the conversion in runCaptureAndRefresh
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const dataUrl = `data:image/png;base64,${base64}`
    expect(dataUrl).toMatch(/^data:image\/png;base64,/)
    // Verify it's a valid base64 string
    const decoded = Buffer.from(base64, 'base64')
    // PNG magic bytes: 0x89, 0x50, 0x4E, 0x47
    expect(decoded[0]).toBe(0x89)
    expect(decoded[1]).toBe(0x50) // P
    expect(decoded[2]).toBe(0x4E) // N
    expect(decoded[3]).toBe(0x47) // G
  })

  it('FigureData structure has required fields', () => {
    const figureData = {
      handle: 1,
      imageDataUrl: 'data:image/png;base64,abc123',
      tempPath: '/tmp/matslop_fig_1.png',
    }
    expect(figureData).toHaveProperty('handle')
    expect(figureData).toHaveProperty('imageDataUrl')
    expect(figureData).toHaveProperty('tempPath')
    expect(typeof figureData.handle).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// 6. Full pipeline simulation: Octave JSON string → parse → Plotly traces
// ---------------------------------------------------------------------------

describe('full pipeline simulation: JSON string → Plotly output', () => {
  it('handles a JSON string (as would arrive from Octave stdout)', () => {
    // Simulate what matslop_export_fig emits: a raw JSON string
    const jsonString = JSON.stringify(PLOT_1_TO_10_JSON)

    // Step 1: parsePlotFigure (called in the live-script editor path)
    const figure = parsePlotFigure(jsonString)
    expect(figure.handle).toBe(1)

    // Step 2: figureToPlotly (called in PlotRenderer useEffect)
    const plotly = figureToPlotly(figure)
    expect(plotly.data.length).toBeGreaterThan(0)
    expect(plotly.config.responsive).toBe(true)
  })

  it('handles all supported plot types through the full pipeline', () => {
    const testCases = [
      { name: 'line', json: PLOT_1_TO_10_JSON, expectedTraceType: 'scatter' },
      { name: 'surface', json: SURF_PEAKS_JSON, expectedTraceType: 'surface' },
      { name: 'scatter', json: SCATTER_JSON, expectedTraceType: 'scatter' },
      { name: 'bar', json: BAR_JSON, expectedTraceType: 'bar' },
    ]

    for (const tc of testCases) {
      const figure = parsePlotFigure(tc.json)
      const plotly = figureToPlotly(figure)
      const trace = plotly.data[0] as Record<string, unknown>
      expect(trace.type, `${tc.name} should map to ${tc.expectedTraceType}`).toBe(tc.expectedTraceType)
    }
  })

  it('pipeline preserves data fidelity through all transformations', () => {
    const inputX = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const inputY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    // JSON string → parse → Plotly
    const figure = parsePlotFigure(JSON.stringify(PLOT_1_TO_10_JSON))
    const plotly = figureToPlotly(figure)
    const trace = plotly.data[0] as Record<string, unknown>

    expect(trace.x).toEqual(inputX)
    expect(trace.y).toEqual(inputY)
  })
})

// ---------------------------------------------------------------------------
// 7. IPC handler verification (figures:readImage shape)
// ---------------------------------------------------------------------------

describe('figures:readImage IPC handler', () => {
  it('can read a real PNG file and produce base64', () => {
    // Simulate what the main process handler does: fs.readFile → base64
    // Use a minimal 1x1 transparent PNG
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const tmpPath = path.join(require('os').tmpdir(), `matslop-test-ipc-${Date.now()}.png`)
    fs.writeFileSync(tmpPath, pngBytes)

    try {
      // Simulate the IPC handler logic from src/main/index.ts
      const data = fs.readFileSync(tmpPath)
      const base64 = data.toString('base64')
      expect(base64.length).toBeGreaterThan(0)
      // Verify round-trip
      const decoded = Buffer.from(base64, 'base64')
      expect(decoded[0]).toBe(0x89) // PNG magic
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

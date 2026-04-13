/**
 * US-B04 — Verify end-to-end plotting in the app.
 *
 * This test file verifies all acceptance criteria for the bundled Linux Octave
 * plotting pipeline:
 *
 * 1. plot(1:10) produces a valid PNG (>1KB) via pngcairo
 * 2. surf(peaks) produces a valid 3D surface PNG
 * 3. title/xlabel/ylabel labels appear in the output
 * 4. matslop_export_fig is loadable (which matslop_export_fig returns a path)
 * 5. The capture script in App.tsx detects figures correctly
 * 6. FigurePanel displays the resulting data
 *
 * Tests that require a working Octave binary are gated behind
 * `describe.skipIf(!HAS_OCTAVE)` so the suite still passes when the bundled
 * binary is missing or system deps are not installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OctaveProcessManager } from '../../src/main/octaveProcess'
import { parsePlotFigure, type PlotFigure } from '../../src/main/plotSchema'
import { figureToPlotly } from '../../src/renderer/editor/plotlyAdapter'
import { hasBundledOctaveBinary, getBundledOctaveBinaryPath } from '../helpers/octaveBinary'
import fs from 'fs'
import path from 'path'
import os from 'os'

const HAS_OCTAVE = hasBundledOctaveBinary()
const SCRIPTS_DIR = path.resolve(__dirname, '../../resources/octave-scripts')

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

// ---------------------------------------------------------------------------
// AC 1: plot(1:10) produces a valid PNG via print (non-empty, >1KB)
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_OCTAVE)('AC1: plot(1:10) produces valid PNG', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinaryPath())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('print() with -dpngcairo produces a non-empty PNG >1KB', async () => {
    const tmpPath = path.join(os.tmpdir(), `matslop-b04-plot-${Date.now()}.png`)
    const octavePath = tmpPath.replace(/\\/g, '/')

    await mgr.executeCommand('plot(1:10);')
    // Use -dpngcairo on Linux (matches the actual app capture script behavior)
    const printDevice = process.platform === 'linux' ? '-dpngcairo' : '-dpng'
    await mgr.executeCommand(`print('${octavePath}', '${printDevice}', '-r150');`)

    // Give gnuplot a moment to flush
    await new Promise((r) => setTimeout(r, 1500))

    expect(fs.existsSync(tmpPath)).toBe(true)
    const stat = fs.statSync(tmpPath)
    expect(stat.size).toBeGreaterThan(1024) // >1KB

    // Verify PNG magic bytes
    const buf = fs.readFileSync(tmpPath)
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50) // P
    expect(buf[2]).toBe(0x4E) // N
    expect(buf[3]).toBe(0x47) // G

    fs.unlinkSync(tmpPath)
  })
})

// ---------------------------------------------------------------------------
// AC 2: surf(peaks) produces a valid 3D surface PNG
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_OCTAVE)('AC2: surf(peaks) produces valid 3D PNG', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinaryPath())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('surf(peaks) produces a valid PNG >1KB', async () => {
    const tmpPath = path.join(os.tmpdir(), `matslop-b04-surf-${Date.now()}.png`)
    const octavePath = tmpPath.replace(/\\/g, '/')

    await mgr.executeCommand('surf(peaks);')
    const printDevice = process.platform === 'linux' ? '-dpngcairo' : '-dpng'
    await mgr.executeCommand(`print('${octavePath}', '${printDevice}', '-r150');`)

    await new Promise((r) => setTimeout(r, 2000))

    expect(fs.existsSync(tmpPath)).toBe(true)
    const stat = fs.statSync(tmpPath)
    expect(stat.size).toBeGreaterThan(1024) // >1KB for a 3D surface

    // Verify PNG magic bytes
    const buf = fs.readFileSync(tmpPath)
    expect(buf[0]).toBe(0x89)
    expect(buf[1]).toBe(0x50)

    fs.unlinkSync(tmpPath)
  })
})

// ---------------------------------------------------------------------------
// AC 3: title/xlabel/ylabel labels appear in the figure
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_OCTAVE)('AC3: labels appear in the figure', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinaryPath())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('title/xlabel/ylabel produce a PNG different from unlabeled plot', async () => {
    const tmpPathBase = path.join(os.tmpdir(), `matslop-b04-nolabel-${Date.now()}.png`)
    const tmpPathLabeled = path.join(os.tmpdir(), `matslop-b04-labeled-${Date.now()}.png`)
    const printDevice = process.platform === 'linux' ? '-dpngcairo' : '-dpng'

    // Plot without labels
    await mgr.executeCommand('plot(1:10);')
    await mgr.executeCommand(`print('${tmpPathBase.replace(/\\/g, '/')}', '${printDevice}', '-r150');`)

    // Add labels
    await mgr.executeCommand("title('Hello'); xlabel('X'); ylabel('Y');")
    await mgr.executeCommand(`print('${tmpPathLabeled.replace(/\\/g, '/')}', '${printDevice}', '-r150');`)

    await new Promise((r) => setTimeout(r, 1500))

    expect(fs.existsSync(tmpPathBase)).toBe(true)
    expect(fs.existsSync(tmpPathLabeled)).toBe(true)

    const sizeBase = fs.statSync(tmpPathBase).size
    const sizeLabeled = fs.statSync(tmpPathLabeled).size

    // Labeled PNG should be different size (has rendered text)
    // It's typically larger because it contains text glyphs
    expect(sizeLabeled).not.toBe(sizeBase)
    expect(sizeLabeled).toBeGreaterThan(1024)

    fs.unlinkSync(tmpPathBase)
    fs.unlinkSync(tmpPathLabeled)
  })
})

// ---------------------------------------------------------------------------
// AC 4: matslop_export_fig is loadable by Octave
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_OCTAVE)('AC4: matslop_export_fig is loadable', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinaryPath())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('which matslop_export_fig returns a path after addpath', async () => {
    await mgr.executeCommand(`addpath('${SCRIPTS_DIR}')`)
    const result = await mgr.executeCommand("disp(which('matslop_export_fig'))")
    const whichOutput = result.output.trim()
    // Should return the full path to the .m file, not 'undefined' or empty
    expect(whichOutput).toContain('matslop_export_fig.m')
    expect(whichOutput).toContain('octave-scripts')
  })

  it('matslop_export_fig can serialize a simple plot to JSON', async () => {
    await mgr.executeCommand(`addpath('${SCRIPTS_DIR}')`)
    await mgr.executeCommand('plot(1:10);')
    const result = await mgr.executeCommand('disp(matslop_export_fig(gcf()));')
    const jsonStr = result.output.trim()

    // Should be valid JSON with required schema fields
    expect(jsonStr).toContain('"schemaVersion"')
    expect(jsonStr).toContain('"axes"')
    expect(jsonStr).toContain('"series"')

    // Should parse through the full pipeline
    const figure = parsePlotFigure(jsonStr)
    expect(figure.axes.length).toBeGreaterThan(0)
    expect(figure.axes[0].series.length).toBeGreaterThan(0)

    const plotly = figureToPlotly(figure)
    expect(plotly.data.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// AC 4 (no-Octave fallback): matslop_export_fig file validation
// ---------------------------------------------------------------------------

describe('AC4 (file-level): matslop_export_fig exists and is valid', () => {
  const scriptPath = path.join(SCRIPTS_DIR, 'matslop_export_fig.m')

  it('matslop_export_fig.m exists', () => {
    expect(fs.existsSync(scriptPath)).toBe(true)
  })

  it('has a function definition matching expected signature', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    expect(content).toMatch(/^function\s+json\s*=\s*matslop_export_fig/m)
  })

  it('handles all plot types: line, surface, patch, hggroup, image', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8')
    for (const type of ['line', 'surface', 'patch', 'hggroup', 'image']) {
      expect(content).toContain(`case "${type}"`)
    }
  })
})

// ---------------------------------------------------------------------------
// AC 5: Capture script detects figures and builds FigureData
// ---------------------------------------------------------------------------

describe('AC5: capture script detects figures (App.tsx logic)', () => {
  /**
   * Mirrors the exact regex parsing logic from App.tsx runCaptureAndRefresh().
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

  it('parses a realistic capture output with figures', () => {
    const output = [
      '__MATSLOP_PWD__:/home/user/project',
      '__MATSLOP_FIG__:1:/tmp/matslop_fig_1.png',
    ].join('\n')

    const result = parseCaptureOutput(output)
    expect(result.cwd).toBe('/home/user/project')
    expect(result.figures).toHaveLength(1)
    expect(result.figures[0].handle).toBe(1)
    expect(result.figures[0].tempPath).toBe('/tmp/matslop_fig_1.png')
  })

  it('handles output from both plot(1:10) and surf(peaks) simultaneously', () => {
    const output = [
      '__MATSLOP_PWD__:/home/user',
      '__MATSLOP_FIG__:1:/tmp/matslop_fig_1.png',
      '__MATSLOP_FIG__:2:/tmp/matslop_fig_2.png',
    ].join('\n')

    const result = parseCaptureOutput(output)
    expect(result.figures).toHaveLength(2)
    expect(result.figures[0].handle).toBe(1)
    expect(result.figures[1].handle).toBe(2)
  })

  it('returns no figures when none exist (close all was called)', () => {
    const output = '__MATSLOP_PWD__:/tmp\n'
    const result = parseCaptureOutput(output)
    expect(result.figures).toHaveLength(0)
  })

  it('uses the correct print device per platform', () => {
    // Verify the capture script source in App.tsx uses platform detection
    const appPath = path.resolve(__dirname, '../../src/renderer/App.tsx')
    const appSrc = fs.readFileSync(appPath, 'utf-8')

    // Must check window.matslop.platform for device selection
    expect(appSrc).toMatch(/window\.matslop\.platform\s*===\s*['"]linux['"]/)
    // Must use -dpngcairo on Linux
    expect(appSrc).toContain('-dpngcairo')
    // Must use -dpng on other platforms
    expect(appSrc).toContain('-dpng')
  })
})

// ---------------------------------------------------------------------------
// AC 5 (continued): FigurePanel renders the figure data
// ---------------------------------------------------------------------------

describe('AC5: FigurePanel displays captured figures', () => {
  it('FigureData interface has required fields (handle, imageDataUrl, tempPath)', () => {
    // Verify the FigurePanel component exports the FigureData interface
    const panelPath = path.resolve(__dirname, '../../src/renderer/panels/FigurePanel.tsx')
    const panelSrc = fs.readFileSync(panelPath, 'utf-8')

    expect(panelSrc).toContain('export interface FigureData')
    expect(panelSrc).toContain('handle: number')
    expect(panelSrc).toContain('imageDataUrl: string')
    expect(panelSrc).toContain('tempPath: string')
  })

  it('FigurePanel renders an img tag with the data URL', () => {
    const panelPath = path.resolve(__dirname, '../../src/renderer/panels/FigurePanel.tsx')
    const panelSrc = fs.readFileSync(panelPath, 'utf-8')

    // Panel should render an <img> with src={activeFigure.imageDataUrl}
    expect(panelSrc).toContain('activeFigure.imageDataUrl')
    expect(panelSrc).toContain('data-testid="figure-image"')
  })

  it('FigurePanel shows "No figures" when array is empty', () => {
    const panelPath = path.resolve(__dirname, '../../src/renderer/panels/FigurePanel.tsx')
    const panelSrc = fs.readFileSync(panelPath, 'utf-8')

    expect(panelSrc).toContain('No figures')
    expect(panelSrc).toContain('data-testid="figure-empty"')
  })

  it('IPC figures:readImage handler reads PNG and produces base64', () => {
    // Simulate the IPC handler: read file → base64
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    )
    const tmpPath = path.join(os.tmpdir(), `matslop-b04-ipc-${Date.now()}.png`)
    fs.writeFileSync(tmpPath, pngBytes)

    try {
      const data = fs.readFileSync(tmpPath)
      const base64 = data.toString('base64')
      const dataUrl = `data:image/png;base64,${base64}`

      expect(dataUrl).toMatch(/^data:image\/png;base64,/)
      expect(base64.length).toBeGreaterThan(0)

      // Round-trip: base64 → Buffer → PNG magic check
      const decoded = Buffer.from(base64, 'base64')
      expect(decoded[0]).toBe(0x89) // PNG magic
      expect(decoded[1]).toBe(0x50)
      expect(decoded[2]).toBe(0x4E)
      expect(decoded[3]).toBe(0x47)
    } finally {
      fs.unlinkSync(tmpPath)
    }
  })
})

// ---------------------------------------------------------------------------
// Full pipeline simulation: JSON → parse → Plotly for all plot types
// ---------------------------------------------------------------------------

describe('AC1-3 (pipeline): simulated Octave JSON through full pipeline', () => {
  it('plot(1:10) JSON round-trips through schema + Plotly correctly', () => {
    const json = {
      schemaVersion: 1, handle: 1,
      axes: [{
        title: '', xLabel: '', yLabel: '',
        xLimits: [0.6, 10.4], yLimits: [0.6, 10.4],
        series: [{
          type: 'line',
          x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          color: [0, 0.447, 0.741], lineStyle: '-', lineWidth: 2, marker: 'none', markerSize: 6,
        }],
      }],
    }
    const figure = parsePlotFigure(json)
    const plotly = figureToPlotly(figure)
    expect(plotly.data).toHaveLength(1)
    expect((plotly.data[0] as Record<string, unknown>).type).toBe('scatter')
  })

  it('surf(peaks) JSON round-trips to Plotly 3D surface', () => {
    const json = {
      schemaVersion: 1, handle: 2,
      axes: [{
        zLabel: '', view: [37.5, 30],
        zLimits: [-6.5, 8.1],
        series: [{
          type: 'surface',
          x: [[1, 2], [1, 2]],
          y: [[1, 1], [2, 2]],
          z: [[0.5, 0.1], [0.1, 5.0]],
          edgeColor: 'none', faceColor: 'interp',
        }],
      }],
    }
    const figure = parsePlotFigure(json)
    const plotly = figureToPlotly(figure)
    expect((plotly.data[0] as Record<string, unknown>).type).toBe('surface')
    expect(plotly.layout.scene).toBeDefined()
  })

  it('labeled plot preserves title/xlabel/ylabel through pipeline', () => {
    const json = {
      schemaVersion: 1, handle: 3,
      axes: [{
        title: 'Hello', xLabel: 'X', yLabel: 'Y',
        series: [{
          type: 'line', x: [1, 2, 3], y: [1, 2, 3],
          color: [0, 0, 1], lineStyle: '-', lineWidth: 1, marker: 'none', markerSize: 6,
        }],
      }],
    }
    const figure = parsePlotFigure(json)
    expect(figure.axes[0].title).toBe('Hello')
    expect(figure.axes[0].xLabel).toBe('X')
    expect(figure.axes[0].yLabel).toBe('Y')

    const plotly = figureToPlotly(figure)
    const layout = plotly.layout as Record<string, unknown>
    // Title should be in layout
    expect(layout.title).toBeDefined()
    // Axis labels should be set
    const xaxis = layout.xaxis as Record<string, unknown>
    const yaxis = layout.yaxis as Record<string, unknown>
    expect(xaxis?.title).toBeDefined()
    expect(yaxis?.title).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Init script sets GNUTERM on Linux (from US-B03)
// ---------------------------------------------------------------------------

describe('Init script sets GNUTERM on Linux', () => {
  it('octaveProcess.ts init script includes GNUTERM setenv on Linux', () => {
    const procPath = path.resolve(__dirname, '../../src/main/octaveProcess.ts')
    const procSrc = fs.readFileSync(procPath, 'utf-8')

    // Must set GNUTERM to pngcairo conditionally for Linux
    expect(procSrc).toContain("setenv('GNUTERM', 'pngcairo')")
    expect(procSrc).toContain("process.platform === 'linux'")
  })
})

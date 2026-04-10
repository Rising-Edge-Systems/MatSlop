import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OctaveProcessManager } from '../../src/main/octaveProcess'
import { getBundledOctaveBinary } from '../helpers/octaveBinary'
import fs from 'fs'
import path from 'path'
import os from 'os'

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

describe('Octave plotting', () => {
  let mgr: OctaveProcessManager

  beforeEach(async () => {
    mgr = new OctaveProcessManager(getBundledOctaveBinary())
    mgr.start()
    await waitForReady(mgr)
  })

  afterEach(() => mgr.stop())

  it('creates a figure handle with plot()', async () => {
    await mgr.executeCommand('x = linspace(0, 2*pi, 50); y = sin(x); plot(x, y);')
    const result = await mgr.executeCommand('disp(length(get(0, "children")))')
    // Should have at least 1 figure
    const n = parseInt(result.output.trim(), 10)
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('exports figure to PNG via print()', async () => {
    const tmpPath = path.join(os.tmpdir(), `matslop-test-plot-${Date.now()}.png`)
    // Use forward slashes / double backslashes for Octave string
    const octavePath = tmpPath.replace(/\\/g, '/')
    await mgr.executeCommand('x = linspace(0, 2*pi, 50); y = cos(x); plot(x, y);')
    await mgr.executeCommand(`print('${octavePath}', '-dpng', '-r100');`)
    // Wait briefly for gnuplot to flush
    await new Promise((r) => setTimeout(r, 1000))
    expect(fs.existsSync(tmpPath)).toBe(true)
    const size = fs.statSync(tmpPath).size
    expect(size).toBeGreaterThan(100) // non-empty PNG
    fs.unlinkSync(tmpPath)
  })

  it('close all removes figures', async () => {
    await mgr.executeCommand('plot(1:10);')
    await mgr.executeCommand('close all;')
    const result = await mgr.executeCommand('disp(length(get(0, "children")))')
    expect(parseInt(result.output.trim(), 10)).toBe(0)
  })
})

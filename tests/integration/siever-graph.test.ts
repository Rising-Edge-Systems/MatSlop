import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OctaveProcessManager } from '../../src/main/octaveProcess'
import { getBundledOctaveBinaryPath, hasBundledOctaveBinary } from '../helpers/octaveBinary'
import fs from 'fs'
import path from 'path'

// US-R01: siever.m runs end-to-end in MatSlop.
//
// siever.m is the user's MATLAB script at
//   C:/Users/benki/Documents/ECE_6998/git/Reconfigurable-Flowpaths/matlab/siever.m
// which motivated the Octave digraph/graph implementation.  An exact-
// content copy lives at tests/fixtures/scripts/siever.m so this test
// works on any checkout (the original path is user-specific).  When
// the user's real siever.m is also present on disk, this test also
// asserts that the fixture matches it byte-for-byte so they cannot
// silently drift.
//
// The script exercises the full US-C04 digraph constructor path:
//   digraph(s, t, w, nodenames)
// with a named node cellstr, then calls plot(G) which returns a
// GraphPlot handle (US-GP01 through US-GP15).  A successful run proves
// that the classdef, the addpath wiring (US-I02), and the plot pipeline
// are all working together.

const HAS_OCTAVE = hasBundledOctaveBinary()

const GRAPH_SCRIPTS_DIR =
  'C:/Users/benki/Documents/RES/projects/octave/scripts/graph'
const HAS_GRAPH_SCRIPTS = fs.existsSync(
  path.join(GRAPH_SCRIPTS_DIR, 'digraph.m'),
)

const ORIGINAL_SIEVER_PATH =
  'C:/Users/benki/Documents/ECE_6998/git/Reconfigurable-Flowpaths/matlab/siever.m'

const FIXTURE_SIEVER_PATH = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'scripts',
  'siever.m',
)

function waitForReady(
  mgr: OctaveProcessManager,
  timeoutMs = 30000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mgr.getStatus() === 'ready') {
      resolve()
      return
    }
    const timer = setTimeout(
      () => reject(new Error(`Octave did not become ready within ${timeoutMs}ms`)),
      timeoutMs,
    )
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

describe.skipIf(!HAS_OCTAVE || !HAS_GRAPH_SCRIPTS)(
  'siever.m end-to-end (US-R01)',
  () => {
    let mgr: OctaveProcessManager

    beforeEach(async () => {
      mgr = new OctaveProcessManager(
        getBundledOctaveBinaryPath(),
        null,
        GRAPH_SCRIPTS_DIR,
      )
      mgr.start()
      await waitForReady(mgr)
    })

    afterEach(() => {
      mgr.stop()
    })

    it('has the siever.m fixture present in tests/fixtures/scripts/', () => {
      expect(fs.existsSync(FIXTURE_SIEVER_PATH)).toBe(true)
      const content = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      // Must contain the 1-based-correction lines and the US-C04 constructor.
      expect(content).toMatch(/rm_sources\s*=\s*rm_sources\s*\+\s*1\s*;/)
      expect(content).toMatch(/digraph\s*\(\s*rm_sources\s*,/)
      expect(content).toMatch(/plot\s*\(\s*G\s*\)/)
    })

    it('fixture matches the user original when the original exists', () => {
      if (!fs.existsSync(ORIGINAL_SIEVER_PATH)) {
        // Dev machine without the user's matlab/ tree — skip the drift check.
        return
      }
      const original = fs.readFileSync(ORIGINAL_SIEVER_PATH, 'utf-8')
      const fixture = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      // Line-ending-tolerant compare — git may CRLF/LF-normalize either copy.
      const normalize = (s: string): string => s.replace(/\r\n/g, '\n')
      expect(normalize(fixture)).toBe(normalize(original))
    })

    it('digraph class resolves once the graph scripts dir is on the path', async () => {
      const r = await mgr.executeCommand("disp(exist('digraph'))")
      // exist('digraph') returns 2 for a .m file on the path.
      expect(parseInt(r.output.trim(), 10)).toBeGreaterThan(0)
      expect(r.error).toBe('')
    })

    it('runs the siever.m script body with no errors', async () => {
      const src = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      const r = await mgr.executeCommand(src)
      expect(r.error).toBe('')
    })

    it('builds a digraph with 9 nodes and 12 edges', async () => {
      const src = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      await mgr.executeCommand(src)
      const nn = await mgr.executeCommand("printf('%d', numnodes(G));")
      expect(nn.output.trim()).toBe('9')
      const ne = await mgr.executeCommand("printf('%d', numedges(G));")
      expect(ne.output.trim()).toBe('12')
      const cls = await mgr.executeCommand("disp(class(G))")
      expect(cls.output.trim()).toBe('digraph')
    })

    it('preserves node names from the rm_names cellstr', async () => {
      const src = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      await mgr.executeCommand(src)
      // Node 1 should be '0', node 9 should be '8' (the +1 re-indexing
      // maps rm_names{i} onto G.Nodes.Name{i}).
      const first = await mgr.executeCommand(
        "disp(G.Nodes.Name{1})",
      )
      expect(first.output.trim()).toBe('0')
      const last = await mgr.executeCommand("disp(G.Nodes.Name{9})")
      expect(last.output.trim()).toBe('8')
    })

    it('plot(G) opens a figure and returns a GraphPlot with the right shape', async () => {
      const src = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      // The fixture already calls plot(G); executing it creates a figure
      // and discards the return value.  Re-run plot to capture the handle.
      await mgr.executeCommand(src)
      const figs = await mgr.executeCommand(
        "printf('%d', length(get(0,'children')));",
      )
      expect(parseInt(figs.output.trim(), 10)).toBeGreaterThanOrEqual(1)

      await mgr.executeCommand('gp = plot(G);')
      const cls = await mgr.executeCommand('disp(class(gp))')
      expect(cls.output.trim()).toBe('GraphPlot')

      const nn = await mgr.executeCommand("printf('%d', gp.NumNodes);")
      expect(nn.output.trim()).toBe('9')
      const ne = await mgr.executeCommand("printf('%d', gp.NumEdges);")
      expect(ne.output.trim()).toBe('12')

      // "nodes and edges visible" = XData/YData populated with finite
      // coordinates for every node.
      const xd = await mgr.executeCommand("printf('%d', numel(gp.XData));")
      expect(xd.output.trim()).toBe('9')
      const yd = await mgr.executeCommand("printf('%d', numel(gp.YData));")
      expect(yd.output.trim()).toBe('9')
      const finite = await mgr.executeCommand(
        "printf('%d', all(isfinite(gp.XData)) && all(isfinite(gp.YData)));",
      )
      expect(finite.output.trim()).toBe('1')
    })

    it('can export the figure to a non-empty PNG', async () => {
      const src = fs.readFileSync(FIXTURE_SIEVER_PATH, 'utf-8')
      await mgr.executeCommand(src)
      const os = await import('os')
      const tmp = path
        .join(os.tmpdir(), `matslop-siever-${Date.now()}.png`)
        .replace(/\\/g, '/')
      // US-B03: Linux bundled gnuplot only has cairo terminals.
      const dev = process.platform === 'linux' ? '-dpngcairo' : '-dpng'
      await mgr.executeCommand(`print('${tmp}', '${dev}', '-r100');`)
      await new Promise((r) => setTimeout(r, 1000))
      expect(fs.existsSync(tmp)).toBe(true)
      const size = fs.statSync(tmp).size
      expect(size).toBeGreaterThan(100)
      fs.unlinkSync(tmp)
    })
  },
)

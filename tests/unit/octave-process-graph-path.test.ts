import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'

// US-I02: when a graphScriptsDir is passed to OctaveProcessManager, its
// init script must include `addpath('<dir>')` so digraph/graph/GraphPlot
// resolve once they're implemented in the Octave fork. Dev mode should
// find C:/Users/benki/Documents/RES/projects/octave/scripts/graph; packaged
// mode should find <resources>/octave-scripts/graph.

class FakeChildProcess extends EventEmitter {
  public writes: string[] = []
  public stdin = {
    write: (data: string) => {
      this.writes.push(data)
      return true
    },
  }
  public stdout = new EventEmitter()
  public stderr = new EventEmitter()
  kill(): boolean {
    return true
  }
}

let lastFake: FakeChildProcess | null = null

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const fake = new FakeChildProcess()
    lastFake = fake
    return fake
  }),
}))

const { OctaveProcessManager } = await import('../../src/main/octaveProcess')

describe('OctaveProcessManager graph scripts path (US-I02)', () => {
  beforeEach(() => {
    lastFake = null
  })

  it('emits addpath for the graph scripts dir when provided', () => {
    const graphDir = 'C:/Users/benki/Documents/RES/projects/octave/scripts/graph'
    const mgr = new OctaveProcessManager('/fake/octave', null, graphDir)
    mgr.start()

    const initScript = lastFake!.writes.find((w) => w.includes('addpath'))
    expect(initScript).toBeTruthy()
    expect(initScript).toContain(`addpath('${graphDir}')`)
  })

  it('converts Windows-style backslashes to forward slashes in the addpath arg', () => {
    const winDir = 'C:\\Users\\benki\\Documents\\RES\\projects\\octave\\scripts\\graph'
    const mgr = new OctaveProcessManager('/fake/octave', null, winDir)
    mgr.start()

    const initScript = lastFake!.writes.find((w) => w.includes('addpath'))
    expect(initScript).toBeTruthy()
    // Backslashes should be forward slashes inside the Octave string.
    expect(initScript).not.toMatch(/addpath\('[^']*\\[^']*'\)/)
    expect(initScript).toContain('C:/Users/benki/Documents/RES/projects/octave/scripts/graph')
  })

  it('omits the addpath statement when no graph dir is provided', () => {
    const mgr = new OctaveProcessManager('/fake/octave')
    mgr.start()

    const joined = lastFake!.writes.join(' ')
    // Only matches the graph-dir pattern; the matslop scripts addpath (if
    // any) wouldn't reach here because scriptsDir is also null.
    expect(joined).not.toMatch(/addpath\([^)]*graph/i)
  })

  it('emits both matslop scripts and graph scripts addpaths when both are provided', () => {
    const scriptsDir = '/tmp/matslop-scripts'
    const graphDir = '/tmp/octave/scripts/graph'
    const mgr = new OctaveProcessManager('/fake/octave', scriptsDir, graphDir)
    mgr.start()

    const joined = lastFake!.writes.join(' ')
    expect(joined).toContain(`addpath('${scriptsDir}')`)
    expect(joined).toContain(`addpath('${graphDir}')`)
  })
})

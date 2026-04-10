import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

describe('Bundled Octave binary', () => {
  it('exists at expected path', () => {
    const root = path.resolve(__dirname, '..', '..')
    const expected = path.join(root, 'resources', 'octave', 'mingw64', 'bin', 'octave-cli.exe')
    expect(fs.existsSync(expected)).toBe(true)
  })

  it('is configured as extraResources in package.json', () => {
    const root = path.resolve(__dirname, '..', '..')
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    expect(pkg.build.extraResources).toBeDefined()
    const extras = pkg.build.extraResources as Array<{ from: string; to: string }>
    const octaveEntry = extras.find((e) => e.from === 'resources/octave')
    expect(octaveEntry).toBeDefined()
    expect(octaveEntry?.to).toBe('octave')
  })
})

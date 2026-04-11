import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

// The bundled Windows Octave binary only exists after `npm run download:octave`
// runs (packaging step). On a clean dev checkout it is absent, so the
// path-correctness assertion is wrapped in `describe.skipIf(...)` — when the
// bundle is present we verify the exact location, otherwise we skip with a
// clear reason. The extraResources check in package.json always runs since
// it only reads the manifest.
const ROOT = path.resolve(__dirname, '..', '..')
const BUNDLED_OCTAVE_WIN = path.join(
  ROOT,
  'resources',
  'octave',
  'mingw64',
  'bin',
  'octave-cli.exe'
)
const HAS_BUNDLED_OCTAVE_WIN = fs.existsSync(BUNDLED_OCTAVE_WIN)

describe.skipIf(!HAS_BUNDLED_OCTAVE_WIN)('Bundled Octave binary (present)', () => {
  it('exists at expected path', () => {
    expect(fs.existsSync(BUNDLED_OCTAVE_WIN)).toBe(true)
  })
})

describe('Bundled Octave packaging manifest', () => {
  it('is configured as extraResources in package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
    expect(pkg.build.extraResources).toBeDefined()
    const extras = pkg.build.extraResources as Array<{ from: string; to: string }>
    const octaveEntry = extras.find((e) => e.from === 'resources/octave')
    expect(octaveEntry).toBeDefined()
    expect(octaveEntry?.to).toBe('octave')
  })
})

import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

// US-038: download-octave.js must ship a macOS branch and package.json's
// build:mac script must invoke download:octave so the bundle ends up inside
// the built .dmg. The extractor path in octaveConfig.ts is exercised for
// darwin in a separate code branch — we assert here that the script and
// manifest stay in sync.
describe('download-octave macOS support', () => {
  const root = path.resolve(__dirname, '..', '..')
  const scriptPath = path.join(root, 'scripts', 'download-octave.js')
  const script = fs.readFileSync(scriptPath, 'utf-8')

  it('defines a darwin entry in DOWNLOADS', () => {
    expect(script).toMatch(/darwin:\s*{/)
  })

  it('downloads an Octave.app DMG for macOS', () => {
    expect(script).toMatch(/\.dmg/)
    expect(script).toMatch(/Octave\.app\/Contents\/Resources\/usr\/bin\/octave-cli/)
  })

  it('uses hdiutil to mount the DMG and copies Octave.app out', () => {
    expect(script).toMatch(/hdiutil attach/)
    expect(script).toMatch(/hdiutil detach/)
  })

  it('build:mac script runs download:octave before electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildMac = pkg.scripts['build:mac'] as string
    expect(buildMac).toContain('download:octave')
    expect(buildMac.indexOf('download:octave')).toBeLessThan(
      buildMac.indexOf('electron-builder')
    )
  })

  it('octaveConfig getBundledOctavePath handles macOS Octave.app layout', () => {
    const cfg = fs.readFileSync(
      path.join(root, 'src', 'main', 'octaveConfig.ts'),
      'utf-8'
    )
    expect(cfg).toMatch(/process\.platform === ['"]darwin['"]/)
    expect(cfg).toMatch(/Octave\.app/)
    expect(cfg).toMatch(/Contents/)
  })
})

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

  it('pins macOS to the latest octave-app release (v9.2 ceiling)', () => {
    // octave-app has not published a v9.4 — US-S01 ran into a 404 on the
    // v${OCTAVE_VERSION}.dmg URL before we pinned the ceiling. Keep this
    // assertion here so a future blanket version bump doesn't regress.
    expect(script).toMatch(/MAC_OCTAVE_VERSION\s*=\s*['"]9\.2['"]/)
    // And the darwin entry must interpolate that (not WIN_OCTAVE_VERSION).
    expect(script).toMatch(/octave-app\/releases\/download\/v\$\{MAC_OCTAVE_VERSION\}/)
  })

  it('Windows URL uses ftpmirror.gnu.org (auto-selects fastest mirror)', () => {
    expect(script).toMatch(/ftpmirror\.gnu\.org\/octave\/windows/)
  })

  it('uses hdiutil to mount the DMG and copies Octave.app out', () => {
    expect(script).toMatch(/hdiutil attach/)
    expect(script).toMatch(/hdiutil detach/)
  })

  it('build:mac script runs electron-vite build and electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildMac = pkg.scripts['build:mac'] as string
    expect(buildMac).toContain('electron-vite build')
    expect(buildMac).toContain('electron-builder --mac')
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

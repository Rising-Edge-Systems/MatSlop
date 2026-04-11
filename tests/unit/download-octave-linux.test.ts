import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'

// US-S01: End-to-end validation against a real Octave install found that
// the community AppImage repo (ryanjdillon/octave-appimage) doesn't exist,
// so Linux bundling was removed. MatSlop now asks Linux users to install
// Octave via their package manager and falls back to PATH lookup at runtime.
// These tests pin that contract so a future well-meaning change doesn't
// silently re-introduce a broken AppImage URL.
describe('download-octave Linux support (unbundled)', () => {
  const root = path.resolve(__dirname, '..', '..')
  const scriptPath = path.join(root, 'scripts', 'download-octave.js')
  const script = fs.readFileSync(scriptPath, 'utf-8')

  it('does not reference the dead ryanjdillon/octave-appimage repo', () => {
    expect(script).not.toMatch(/ryanjdillon/)
  })

  it('has no linux entry in the DOWNLOADS map', () => {
    // There must be no `linux: {` block inside the DOWNLOADS object. We
    // assert the whole file contains no such key — the macOS/Windows entries
    // use `win32:` and `darwin:`.
    expect(script).not.toMatch(/\blinux:\s*{/)
  })

  it('main() short-circuits for --platform=linux with a clear message', () => {
    expect(script).toMatch(/platform === ['"]linux['"]/)
    expect(script).toMatch(/No bundled Octave for Linux/)
    // Must advertise at least one package-manager install path.
    expect(script).toMatch(/apt install octave/)
  })

  it('running the script with --platform=linux exits 0 and prints guidance', () => {
    const out = execFileSync('node', [scriptPath, '--platform=linux'], {
      encoding: 'utf-8',
      cwd: root,
      timeout: 15000
    })
    expect(out).toMatch(/No bundled Octave for Linux/)
    expect(out).toMatch(/PATH/)
    // No HTTP 404 stacktrace should appear.
    expect(out).not.toMatch(/HTTP 4\d\d/)
  })

  it('build:linux script still invokes download:octave (no-op message) before electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildLinux = pkg.scripts['build:linux'] as string
    expect(buildLinux).toContain('download:octave')
    expect(buildLinux.indexOf('download:octave')).toBeLessThan(
      buildLinux.indexOf('electron-builder')
    )
  })

  it('octaveConfig still supports the squashfs-root layout as a legacy fallback', () => {
    // The runtime bundled-path resolver retains the squashfs-root branch so
    // a user who manually drops an AppImage into resources/octave/ keeps
    // working, even though download-octave.js no longer populates it.
    const cfg = fs.readFileSync(
      path.join(root, 'src', 'main', 'octaveConfig.ts'),
      'utf-8'
    )
    expect(cfg).toMatch(/squashfs-root/)
    expect(cfg).toMatch(/usr['"],\s*['"]bin/)
  })

  it('linux autoDetect falls back to PATH / known unix bin dirs', () => {
    const cfg = fs.readFileSync(
      path.join(root, 'src', 'main', 'octaveConfig.ts'),
      'utf-8'
    )
    expect(cfg).toMatch(/findInPath\(['"]octave-cli['"]\)/)
  })
})

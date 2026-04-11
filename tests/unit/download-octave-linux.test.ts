import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

// US-039: download-octave.js must ship a Linux branch (AppImage) and
// package.json's build:linux script must invoke download:octave so the
// bundle ends up inside the built AppImage / .deb / .rpm. The extractor
// path in octaveConfig.ts is exercised for linux in a separate code branch
// — we assert here that the script and manifest stay in sync.
describe('download-octave Linux support', () => {
  const root = path.resolve(__dirname, '..', '..')
  const scriptPath = path.join(root, 'scripts', 'download-octave.js')
  const script = fs.readFileSync(scriptPath, 'utf-8')

  it('defines a linux entry in DOWNLOADS', () => {
    expect(script).toMatch(/linux:\s*{/)
  })

  it('downloads an Octave AppImage for Linux', () => {
    expect(script).toMatch(/AppImage/)
    expect(script).toMatch(/squashfs-root\/usr\/bin\/octave-cli/)
  })

  it('uses --appimage-extract to unpack the AppImage', () => {
    expect(script).toMatch(/--appimage-extract/)
    // Must chmod +x the AppImage before executing it.
    expect(script).toMatch(/chmodSync[^\n]*0o755/)
  })

  it('build:linux script runs download:octave before electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildLinux = pkg.scripts['build:linux'] as string
    expect(buildLinux).toContain('download:octave')
    expect(buildLinux.indexOf('download:octave')).toBeLessThan(
      buildLinux.indexOf('electron-builder')
    )
  })

  it('octaveConfig getBundledOctavePath handles Linux AppImage layout', () => {
    const cfg = fs.readFileSync(
      path.join(root, 'src', 'main', 'octaveConfig.ts'),
      'utf-8'
    )
    expect(cfg).toMatch(/squashfs-root/)
    expect(cfg).toMatch(/usr['"],\s*['"]bin/)
  })
})

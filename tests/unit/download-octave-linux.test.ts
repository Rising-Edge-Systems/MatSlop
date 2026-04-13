import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

// US-B01: Linux bundling via Ubuntu .deb packages. The script downloads
// octave, octave-common, liboctave-dev, and fonts-freefont-otf .deb packages
// from the Ubuntu Noble archive and extracts them to resources/octave/.
describe('download-octave Linux support (.deb bundling)', () => {
  const root = path.resolve(__dirname, '..', '..')
  const scriptPath = path.join(root, 'scripts', 'download-octave.js')
  const script = fs.readFileSync(scriptPath, 'utf-8')

  it('does not reference the dead ryanjdillon/octave-appimage repo', () => {
    expect(script).not.toMatch(/ryanjdillon/)
  })

  it('defines LINUX_DEBS array with the expected .deb packages', () => {
    expect(script).toMatch(/LINUX_DEBS/)
    // Template literals use LINUX_OCTAVE_VERSION for octave packages
    expect(script).toMatch(/octave_.*-1build4_amd64\.deb/)
    expect(script).toMatch(/octave-common_.*-1build4_all\.deb/)
    expect(script).toMatch(/liboctave-dev_.*-1build4_amd64\.deb/)
    expect(script).toMatch(/fonts-freefont-otf_20211204/)
  })

  it('downloads from archive.ubuntu.com', () => {
    expect(script).toMatch(/archive\.ubuntu\.com\/ubuntu\/pool\/universe\/o\/octave/)
    expect(script).toMatch(/archive\.ubuntu\.com\/ubuntu\/pool\/main\/f\/fonts-freefont/)
  })

  it('has a downloadLinuxDebs function with dpkg-deb extraction and ar fallback', () => {
    expect(script).toMatch(/downloadLinuxDebs/)
    expect(script).toMatch(/dpkg-deb -x/)
    expect(script).toMatch(/ar x/)
  })

  it('checks for existing binary for idempotency', () => {
    expect(script).toMatch(/usr.*bin.*octave-cli/)
    expect(script).toMatch(/already downloaded/)
  })

  it('verifies FreeSans.otf font after extraction', () => {
    expect(script).toMatch(/FreeSans\.otf/)
    expect(script).toMatch(/usr.*share.*fonts.*opentype.*freefont/)
  })

  it('main() routes linux platform to downloadLinuxDebs', () => {
    expect(script).toMatch(/platform === ['"]linux['"]/)
    expect(script).toMatch(/downloadLinuxDebs/)
  })

  it('build:linux script still invokes download:octave before electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildLinux = pkg.scripts['build:linux'] as string
    expect(buildLinux).toContain('download:octave')
    expect(buildLinux.indexOf('download:octave')).toBeLessThan(
      buildLinux.indexOf('electron-builder')
    )
  })

  it('octaveConfig still supports the squashfs-root layout as a legacy fallback', () => {
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

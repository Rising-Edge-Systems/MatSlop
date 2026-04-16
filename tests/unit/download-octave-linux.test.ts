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
    expect(script).toMatch(/octave_.*-1build5_amd64\.deb/)
    expect(script).toMatch(/octave-common_.*-1build5_all\.deb/)
    expect(script).toMatch(/octave-dev_.*-1build5_amd64\.deb/)
    expect(script).toMatch(/fonts-freefont-otf_20211204/)
  })

  it('downloads from archive.ubuntu.com', () => {
    expect(script).toMatch(/archive\.ubuntu\.com\/ubuntu\/pool\/universe\/o\/octave/)
    expect(script).toMatch(/archive\.ubuntu\.com\/ubuntu\/pool\/universe\/f\/fonts-freefont/)
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

  it('build:linux script runs electron-vite build and electron-builder', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    const buildLinux = pkg.scripts['build:linux'] as string
    expect(buildLinux).toContain('electron-vite build')
    expect(buildLinux).toContain('electron-builder --linux')
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

// US-B02: Font redirect shim, fonts.conf, and wrapper script
describe('download-octave Linux support (US-B02: shim & wrapper)', () => {
  const root = path.resolve(__dirname, '..', '..')
  const scriptPath = path.join(root, 'scripts', 'download-octave.js')
  const script = fs.readFileSync(scriptPath, 'utf-8')

  it('contains a FONT_REDIRECT_C source string with openat interception', () => {
    expect(script).toMatch(/FONT_REDIRECT_C/)
    expect(script).toMatch(/openat/)
    expect(script).toMatch(/dlsym\(RTLD_NEXT/)
    expect(script).toMatch(/MATSLOP_OCTAVE_ROOT/)
    expect(script).toMatch(/\/usr\/share\/fonts\/opentype\/freefont\//)
  })

  it('has a compileFontRedirect function that uses gcc', () => {
    expect(script).toMatch(/function compileFontRedirect/)
    expect(script).toMatch(/gcc -shared -fPIC/)
    expect(script).toMatch(/font_redirect\.so/)
    expect(script).toMatch(/-ldl/)
  })

  it('removes C source after compilation', () => {
    // The finally block should unlink the .c file
    expect(script).toMatch(/unlinkSync.*font_redirect\.c|unlink.*cPath/)
  })

  it('warns and skips when gcc is not available', () => {
    expect(script).toMatch(/gcc not available/)
    expect(script).toMatch(/WARNING/)
  })

  it('has a createFontsConf function producing fontconfig XML', () => {
    expect(script).toMatch(/function createFontsConf/)
    expect(script).toMatch(/fonts\.conf/)
    expect(script).toMatch(/<fontconfig>/)
    expect(script).toMatch(/usr\/share\/fonts\/opentype\/freefont/)
    expect(script).toMatch(/\/usr\/share\/fonts/)
  })

  it('has a createWrapperScript function creating bin/octave-cli wrapper', () => {
    expect(script).toMatch(/function createWrapperScript/)
    expect(script).toMatch(/bin.*octave-cli/)
    // Wrapper sets key environment variables
    expect(script).toMatch(/MATSLOP_OCTAVE_ROOT/)
    expect(script).toMatch(/LD_LIBRARY_PATH/)
    expect(script).toMatch(/LD_PRELOAD/)
    expect(script).toMatch(/OCTAVE_HOME/)
    expect(script).toMatch(/GNUTERM.*pngcairo|pngcairo.*GNUTERM/)
    expect(script).toMatch(/FONTCONFIG_FILE/)
    // Execs real binary
    expect(script).toMatch(/usr\/bin\/octave-cli/)
  })

  it('wrapper script is made executable (mode 0o755)', () => {
    expect(script).toMatch(/0o755|755/)
  })

  it('main() calls compileFontRedirect, createFontsConf, createWrapperScript for linux', () => {
    // After downloadLinuxDebs(), the three setup functions are called
    expect(script).toMatch(/compileFontRedirect\(\)/)
    expect(script).toMatch(/createFontsConf\(\)/)
    expect(script).toMatch(/createWrapperScript\(\)/)
  })
})

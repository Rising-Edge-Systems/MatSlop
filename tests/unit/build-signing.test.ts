import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'

// US-040: Windows code signing. Electron-builder is configured to read a
// cert from env vars (CSC_LINK / CSC_KEY_PASSWORD) and sign the NSIS
// installer with sha256 + an RFC-3161 timestamp. We lock that config in
// package.json so future refactors don't silently drop signing, and assert
// the build-signing docs explain how to supply the cert.
describe('US-040 Windows code signing', () => {
  const root = path.resolve(__dirname, '..', '..')
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8'),
  ) as {
    build: {
      win: {
        target: unknown
        signingHashAlgorithms?: string[]
        rfc3161TimeStampServer?: string
        signDlls?: boolean
      }
    }
  }

  it('package.json build.win pins signingHashAlgorithms to sha256', () => {
    const algs = pkgJson.build.win.signingHashAlgorithms
    expect(Array.isArray(algs)).toBe(true)
    expect(algs).toContain('sha256')
  })

  it('package.json build.win uses an RFC-3161 timestamp server', () => {
    const ts = pkgJson.build.win.rfc3161TimeStampServer
    expect(typeof ts).toBe('string')
    expect(ts).toMatch(/^https?:\/\//)
  })

  it('package.json build.win still targets nsis (installer we sign)', () => {
    expect(pkgJson.build.win.target).toContain('nsis')
  })

  describe('docs/build-signing.md', () => {
    const docPath = path.join(root, 'docs', 'build-signing.md')
    const exists = fs.existsSync(docPath)

    it('exists', () => {
      expect(exists).toBe(true)
    })

    const doc = exists ? fs.readFileSync(docPath, 'utf-8') : ''

    it('documents CSC_LINK and CSC_KEY_PASSWORD env vars', () => {
      expect(doc).toMatch(/CSC_LINK/)
      expect(doc).toMatch(/CSC_KEY_PASSWORD/)
    })

    it('explains the unsigned fallback for local dev', () => {
      expect(doc.toLowerCase()).toMatch(/unsigned/)
    })

    it('shows a CI (GitHub Actions) usage example', () => {
      expect(doc).toMatch(/GitHub Actions|secrets\./)
    })
  })
})

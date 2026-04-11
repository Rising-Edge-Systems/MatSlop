import { describe, it, expect } from 'vitest'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'

// US-042: macOS notarization. electron-builder is wired to call
// scripts/notarize.cjs as an afterSign hook, which either runs the .app
// through Apple's notary service OR skips gracefully when credentials are
// missing. We pin the config in package.json and the skip behavior here so
// future refactors don't silently drop notarization OR fail local dev builds.
describe('US-042 macOS notarization', () => {
  const root = path.resolve(__dirname, '..', '..')
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf-8'),
  ) as {
    build: {
      afterSign?: string
      mac: {
        target: unknown
        hardenedRuntime?: boolean
      }
    }
  }

  describe('package.json build config', () => {
    it('wires afterSign hook to scripts/notarize.cjs', () => {
      expect(pkgJson.build.afterSign).toBe('scripts/notarize.cjs')
    })

    it('enables hardenedRuntime on mac (required by Apple notary service)', () => {
      expect(pkgJson.build.mac.hardenedRuntime).toBe(true)
    })

    it('still targets dmg (the artifact we notarize)', () => {
      expect(pkgJson.build.mac.target).toContain('dmg')
    })
  })

  describe('scripts/notarize.cjs', () => {
    const scriptPath = path.join(root, 'scripts', 'notarize.cjs')

    it('exists on disk', () => {
      expect(fs.existsSync(scriptPath)).toBe(true)
    })

    const require = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = require(scriptPath) as any

    it('default export is a function (afterSign hook)', () => {
      expect(typeof mod).toBe('function')
    })

    it('exports notarizeSkipReason helper', () => {
      expect(typeof mod.notarizeSkipReason).toBe('function')
    })

    describe('notarizeSkipReason', () => {
      const skip = (env: Record<string, string | undefined>) =>
        mod.notarizeSkipReason(env) as string | null

      it('returns a reason when APPLE_ID is missing', () => {
        const reason = skip({
          APPLE_APP_SPECIFIC_PASSWORD: 'pw',
          APPLE_TEAM_ID: 'TEAM',
        })
        expect(reason).toMatch(/APPLE_ID/)
      })

      it('returns a reason when APPLE_APP_SPECIFIC_PASSWORD is missing', () => {
        const reason = skip({
          APPLE_ID: 'a@b.com',
          APPLE_TEAM_ID: 'TEAM',
        })
        expect(reason).toMatch(/APPLE_APP_SPECIFIC_PASSWORD/)
      })

      it('returns a reason when APPLE_TEAM_ID is missing', () => {
        const reason = skip({
          APPLE_ID: 'a@b.com',
          APPLE_APP_SPECIFIC_PASSWORD: 'pw',
        })
        expect(reason).toMatch(/APPLE_TEAM_ID/)
      })

      it('accepts legacy APPLE_ID_PASSWORD in lieu of APPLE_APP_SPECIFIC_PASSWORD', () => {
        const reason = skip({
          APPLE_ID: 'a@b.com',
          APPLE_ID_PASSWORD: 'pw',
          APPLE_TEAM_ID: 'TEAM',
        })
        expect(reason).toBeNull()
      })

      it('returns null when all three env vars are present', () => {
        const reason = skip({
          APPLE_ID: 'a@b.com',
          APPLE_APP_SPECIFIC_PASSWORD: 'pw',
          APPLE_TEAM_ID: 'TEAM',
        })
        expect(reason).toBeNull()
      })

      it('reports ALL missing vars at once so users fix them in one pass', () => {
        const reason = skip({}) || ''
        expect(reason).toMatch(/APPLE_ID/)
        expect(reason).toMatch(/APPLE_APP_SPECIFIC_PASSWORD/)
        expect(reason).toMatch(/APPLE_TEAM_ID/)
      })
    })

    describe('afterSign hook (non-darwin short-circuit)', () => {
      it('resolves without error for a non-darwin platform', async () => {
        await expect(
          mod({
            electronPlatformName: 'linux',
            appOutDir: '/tmp/nope',
            packager: { appInfo: { productFilename: 'MatSlop' } },
          }),
        ).resolves.toBeUndefined()
      })
    })

    describe('afterSign hook (darwin + missing creds)', () => {
      it('skips gracefully instead of throwing when env vars are absent', async () => {
        const origEnv = { ...process.env }
        delete process.env.APPLE_ID
        delete process.env.APPLE_APP_SPECIFIC_PASSWORD
        delete process.env.APPLE_ID_PASSWORD
        delete process.env.APPLE_TEAM_ID
        try {
          await expect(
            mod({
              electronPlatformName: 'darwin',
              appOutDir: '/tmp/matslop-notarize-test',
              packager: { appInfo: { productFilename: 'MatSlop' } },
            }),
          ).resolves.toBeUndefined()
        } finally {
          process.env = origEnv
        }
      })
    })
  })

  describe('docs/macos-notarization.md', () => {
    const docPath = path.join(root, 'docs', 'macos-notarization.md')
    const exists = fs.existsSync(docPath)

    it('exists', () => {
      expect(exists).toBe(true)
    })

    const doc = exists ? fs.readFileSync(docPath, 'utf-8') : ''

    it('documents the Apple Developer ID setup', () => {
      expect(doc).toMatch(/Developer ID/)
    })

    it('documents APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID env vars', () => {
      expect(doc).toMatch(/APPLE_ID/)
      expect(doc).toMatch(/APPLE_APP_SPECIFIC_PASSWORD/)
      expect(doc).toMatch(/APPLE_TEAM_ID/)
    })

    it('explains the graceful skip for missing credentials', () => {
      expect(doc.toLowerCase()).toMatch(/skip/)
    })

    it('shows a CI (GitHub Actions) usage example', () => {
      expect(doc).toMatch(/GitHub Actions|secrets\./)
    })
  })
})

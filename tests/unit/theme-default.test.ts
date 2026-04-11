import { describe, it, expect, vi } from 'vitest'

// US-Q01: Document the seeded default theme. We mock electron-store so the
// module is importable in a pure-node test environment (the real store
// constructor pulls in electron's `app.getPath`, which is unavailable here).
vi.mock('electron-store', () => {
  return {
    default: class FakeStore {
      private data: Record<string, unknown> = {}
      get(key: string, fallback: unknown): unknown {
        return key in this.data ? this.data[key] : fallback
      }
      set(key: string, value: unknown): void {
        this.data[key] = value
      }
    },
  }
})

describe('US-Q01: seeded default theme', () => {
  it('DEFAULT_THEME is dark, not system', async () => {
    const mod = await import('../../src/main/appConfig')
    expect(mod.DEFAULT_THEME).toBe('dark')
  })

  it('getStoredTheme() returns dark for a fresh store with no persisted value', async () => {
    const mod = await import('../../src/main/appConfig')
    expect(mod.getStoredTheme()).toBe('dark')
  })

  it('getPreferences().theme is dark for a fresh store', async () => {
    const mod = await import('../../src/main/appConfig')
    expect(mod.getPreferences().theme).toBe('dark')
  })
})

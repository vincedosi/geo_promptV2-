import { describe, it, expect } from 'vitest'
import { resolveInitialTheme, nextTheme, STORAGE_KEY } from '@/lib/theme/theme-utils'

function makeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe('resolveInitialTheme', () => {
  it('returns "dark" when storage is empty', () => {
    expect(resolveInitialTheme(makeStorage())).toBe('dark')
  })

  it('returns "light" when storage has "light"', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'light' }))).toBe('light')
  })

  it('returns "dark" when storage has "dark"', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('falls back to "dark" when storage has garbage', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'purple' }))).toBe('dark')
  })

  it('returns "dark" when storage is null (SSR)', () => {
    expect(resolveInitialTheme(null)).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('toggles dark → light', () => {
    expect(nextTheme('dark')).toBe('light')
  })

  it('toggles light → dark', () => {
    expect(nextTheme('light')).toBe('dark')
  })
})

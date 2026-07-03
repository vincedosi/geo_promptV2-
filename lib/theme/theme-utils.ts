export type Theme = 'dark' | 'light'

export const STORAGE_KEY = 'magelian-theme'

type StorageLike = {
  getItem: (key: string) => string | null
}

export function resolveInitialTheme(storage: StorageLike | null | undefined): Theme {
  if (!storage) return 'dark'
  const raw = storage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'dark'
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

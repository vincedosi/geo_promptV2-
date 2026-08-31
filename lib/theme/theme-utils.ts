/**
 * MAGELIAN — resolution du theme clair/sombre.
 *
 * `resolveInitialTheme()` lit la preference persistee et retombe sur
 * 'dark', theme par defaut du design system. Prend un StorageLike plutot
 * que localStorage directement, pour rester testable et sans acces DOM.
 */
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

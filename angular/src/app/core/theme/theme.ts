/**
 * Règles du thème, identiques à lib/theme/theme-utils.ts côté React — MÊME
 * clé de stockage : les deux applications tournent sur localhost, mais sur
 * deux ports, donc deux stockages distincts ; la clé commune évite seulement
 * deux noms pour une même préférence le jour de la bascule.
 */
export type Theme = 'dark' | 'light';

export const CLE_THEME = 'magelian-theme';

export function themeInitial(stockage: Pick<Storage, 'getItem'> | null): Theme {
  if (!stockage) return 'dark';
  try {
    const brut = stockage.getItem(CLE_THEME);
    return brut === 'light' || brut === 'dark' ? brut : 'dark';
  } catch {
    return 'dark';
  }
}

export function themeSuivant(courant: Theme): Theme {
  return courant === 'dark' ? 'light' : 'dark';
}

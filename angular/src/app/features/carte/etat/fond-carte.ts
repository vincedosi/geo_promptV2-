import { MAP_STYLES } from '../logique/fonds';

/** La clé `localStorage` de React (`page.tsx:320-330`), reprise telle quelle (arbitrage B9). */
export const CLE_FOND = 'genesis_map_style';

/** L'id du fond par défaut : Liberty (« Standard »), `MAP_STYLES[0]` comme `MAP_STYLE` de React. */
export const FOND_DEFAUT: string = MAP_STYLES[0].id;

/**
 * Le fond mémorisé, en id de `MAP_STYLES`. React mémorise l'URL ; Angular mémorise l'id, parce que « Clair » et
 * « MAGELIAN » partagent l'URL de Positron et que l'URL ne permet donc pas de les distinguer. Une URL (valeur
 * écrite à l'ancienne) est relue comme le PREMIER fond qui la porte. Tout le reste — clé absente, valeur
 * inconnue, stockage qui lève (navigation privée, données bloquées) — rend le fond par défaut, sans erreur.
 */
export function lireFondMemorise(stockage: () => Storage | null | undefined): string {
  let valeur: string | null = null;
  try {
    valeur = stockage()?.getItem(CLE_FOND) ?? null;
  } catch {
    return FOND_DEFAUT;
  }
  if (!valeur) return FOND_DEFAUT;
  return (MAP_STYLES.find((s) => s.id === valeur) ?? MAP_STYLES.find((s) => s.url === valeur))?.id ?? FOND_DEFAUT;
}

/** Écrit le fond choisi ; un stockage qui lève est ignoré (préférence de poste, jamais un état nécessaire). */
export function memoriserFond(stockage: () => Storage | null | undefined, id: string): void {
  try {
    stockage()?.setItem(CLE_FOND, id);
  } catch {
    // Stockage indisponible : la carte fonctionne, le choix ne survivra simplement pas au rechargement.
  }
}

/** L'URL de style d'un id de fond (défaut si inconnu). */
export function urlDuFond(id: string): string {
  return (MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0]).url;
}

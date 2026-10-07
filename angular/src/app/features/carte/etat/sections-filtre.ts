/**
 * Les sections repliables INTERNES des calques (poi, transport, tmja, ooh, radio, civic, civicHealth, meteo) —
 * portage de la logique de `app/map/_components/filter-panel/use-filter-sections.ts` (fonctions pures ; l'état vit
 * dans le panneau Calques, et les sections des tâches 8 à 12 le liront).
 *
 * Deux règles conservées telles quelles :
 * - en mode OVERLAY — celui du panneau Calques, `PanneauCalques.tsx:249` — seules les sections territoriales sont
 *   ouvertes et RIEN n'est lu ni écrit dans `localStorage` : l'utilisateur filtre la zone AVANT d'afficher des POI ;
 * - hors overlay, l'état est relu de `localStorage['magelian-filter-sections']`, complété des sections ajoutées depuis,
 *   et un stockage qui lève (navigation privée, données bloquées) rend l'état par défaut.
 *
 * L'auto-ouverture de « Santé environnementale » au premier IRIS sélectionné arrivera avec sa section (T10).
 */
export const SECTION_KEYS = [
  'perimetre', 'regions', 'departements', 'recherche',
  'poi', 'transport', 'tmja', 'ooh', 'radio', 'civic', 'civicHealth', 'meteo',
] as const;

/** Sections fermées au premier rendu (zone-spécifiques). */
const DEFAULT_CLOSED = new Set<string>(['civicHealth']);
/** Sections ouvertes par défaut en mode overlay. */
const TERRITORY_OPEN = new Set<string>(['perimetre', 'regions', 'departements']);
/** La clé de `use-filter-sections.ts:47`. */
export const CLE_SECTIONS = 'magelian-filter-sections';

/** Le stockage, lu à la demande (peut lever, ou être absent). */
export type LireStockage = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;

export function sectionsInitiales(modeOverlay: boolean, stockage: LireStockage): Record<string, boolean> {
  if (modeOverlay) return Object.fromEntries(SECTION_KEYS.map((k) => [k, TERRITORY_OPEN.has(k)]));
  const toutOuvert = (): Record<string, boolean> => Object.fromEntries(SECTION_KEYS.map((k) => [k, !DEFAULT_CLOSED.has(k)]));
  try {
    const sauve = stockage()?.getItem(CLE_SECTIONS);
    if (sauve) {
      const lu = JSON.parse(sauve) as Record<string, boolean>;
      for (const k of SECTION_KEYS) if (!(k in lu)) lu[k] = !DEFAULT_CLOSED.has(k);
      return lu;
    }
  } catch { /* stockage illisible : état par défaut */ }
  return toutOuvert();
}

/** Bascule une section ; ne persiste QUE hors overlay (`use-filter-sections.ts:97-104`). */
export function basculerSection(
  etat: Record<string, boolean>, cle: string, modeOverlay: boolean, stockage: LireStockage,
): Record<string, boolean> {
  const suivant = { ...etat, [cle]: !etat[cle] };
  if (!modeOverlay) {
    try { stockage()?.setItem(CLE_SECTIONS, JSON.stringify(suivant)); } catch { /* stockage bloqué */ }
  }
  return suivant;
}

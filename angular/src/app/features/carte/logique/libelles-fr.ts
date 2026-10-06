/**
 * Libellés du fond de carte en FRANÇAIS — copie Angular (lot 4) de `patchLabelFrValeur` et de la boucle
 * `map.on('load')` de `app/copilote/_hooks/useMapInit.ts:16-33,209-215`. React ne les exporte pas
 * (fonctions locales du crochet) : la copie est verrouillée par `libelles-fr.spec.ts` sur les formes
 * d'expression que le style Liberty porte réellement.
 *
 * OpenFreeMap sert ses libellés en anglais (`name_en` / `name:en`) : sans ce correctif, la carte
 * affiche « Switzerland », « Genoa », « Brittany » là où React affiche « Suisse », « Gênes »,
 * « Bretagne ». Toute référence à `name_en`/`name:en` devient `coalesce(name:fr, name)`.
 */

/** Remplace récursivement name_en/name:en par le nom français, ou à défaut le nom local. */
export function patchLabelFrValeur(expr: unknown): unknown {
  if (!expr) return expr;
  if (typeof expr === 'string') {
    return expr.replace(/\{name_en\}/g, '{name}').replace(/\{name:en\}/g, '{name}');
  }
  if (Array.isArray(expr)) {
    if (expr[0] === 'get' && (expr[1] === 'name_en' || expr[1] === 'name:en')) {
      return ['coalesce', ['get', 'name:fr'], ['get', 'name']];
    }
    return expr.map(patchLabelFrValeur);
  }
  if (typeof expr === 'object' && expr !== null) {
    return Object.fromEntries(
      Object.entries(expr as Record<string, unknown>).map(([k, v]) => [k, patchLabelFrValeur(v)]),
    );
  }
  return expr;
}

/** La surface de carte employée : de quoi lire les couches et réécrire leur `text-field`. */
interface CarteLibelles {
  getStyle(): { layers?: { id: string; type: string; layout?: Record<string, unknown> }[] } | undefined;
  setLayoutProperty(couche: string, propriete: string, valeur: unknown): unknown;
}

/** Applique le correctif à chaque couche symbole du style chargé (`useMapInit.ts:209-215`). */
export function franciserLibelles(carte: CarteLibelles): void {
  for (const couche of carte.getStyle()?.layers ?? []) {
    if (couche.type !== 'symbol') continue;
    const champ = couche.layout?.['text-field'];
    if (!champ) continue;
    try { carte.setLayoutProperty(couche.id, 'text-field', patchLabelFrValeur(champ)); } catch { /* hors vue */ }
  }
}

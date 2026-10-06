/**
 * Le fond « MAGELIAN » — portage de `applyMagelianStyle` (`lib/map/magelian-style.ts`), appliqué sur le
 * style Positron au `load` et ré-appliqué à chaque bascule de thème (`useMapInit.ts:217-221,1091-1102`).
 *
 * ── COULEURS PAR JETONS DÉDIÉS, JAMAIS DE HEX ────────────────────────────
 * React tenait deux tables d'hexadécimaux (`MAGELIAN_PALETTE.dark` / `.light`). Ici chaque rôle a SON jeton,
 * `--carte-magelian-*` (`styles/jetons.css`, `app/globals.css`, DESIGN_SYSTEM.md), aux valeurs EXACTES de React
 * dans les deux thèmes, lu par `CouleursService.palette(JETONS_STYLE_MAGELIAN)` — un `Signal` qui suit le thème.
 * Des jetons dédiés plutôt que des jetons d'interface : retoucher une bordure d'UI ne doit pas changer le fond.
 * MapLibre ne résout pas `var()` dans `paint` : la fonction reçoit des valeurs CALCULÉES. (`park` n'est lu par
 * aucune règle de React : il n'est pas repris.)
 *
 * ── SEULES LES COUCHES DU FOND SONT REPEINTES ────────────────────────────
 * Les règles de React reconnaissent les couches par leur id (« water », « road », tout `symbol`, « catch-all
 * fill »…) : appliquées à TOUTES les couches du style, elles repeindraient aussi les couches de données que
 * l'application pose ensuite (météo, couverture radio, étiquettes de zones…), et à chaque bascule de thème.
 * React n'avait pas ce problème que parce que ses surcharges ne s'appliquaient jamais (défaut d'URL). La page
 * relève donc les ids du style de FOND au `load`, avant toute couche de l'application, et ne passe que ceux-là.
 */

/** Les rôles du fond MAGELIAN et le jeton qui porte chacun (`--carte-magelian-*`). */
export const JETONS_STYLE_MAGELIAN = {
  fond: 'carte-magelian-fond',
  eau: 'carte-magelian-eau',
  contourEau: 'carte-magelian-contour-eau',
  sol: 'carte-magelian-sol',
  occupationSol: 'carte-magelian-occupation-sol',
  batiment: 'carte-magelian-batiment',
  contourBatiment: 'carte-magelian-contour-batiment',
  routePrincipale: 'carte-magelian-route-principale',
  routeSecondaire: 'carte-magelian-route-secondaire',
  autoroute: 'carte-magelian-autoroute',
  frontiere: 'carte-magelian-frontiere',
  libelleVille: 'carte-magelian-libelle-ville',
  libelleRegion: 'carte-magelian-libelle-region',
  haloLibelle: 'carte-magelian-halo-libelle',
  libelleMineur: 'carte-magelian-libelle-mineur',
} as const;

export type PaletteStyleMagelian = Record<keyof typeof JETONS_STYLE_MAGELIAN, string>;

/** Les ids des couches du style de FOND, relevés au `load` avant toute couche de l'application. */
export function couchesDuFond(carte: CarteStyleMagelian): ReadonlySet<string> {
  return new Set((carte.getStyle()?.layers ?? []).map((c) => c.id));
}

/** La surface de carte employée — de quoi lire les couches du style et les repeindre. */
export interface CarteStyleMagelian {
  getStyle(): { layers?: { id: string; type: string }[] } | undefined;
  setPaintProperty(couche: string, propriete: string, valeur: unknown): unknown;
}

/**
 * Repeint les couches du FOND (`couchesFond`, relevé par `couchesDuFond` au `load`) — mêmes règles de
 * reconnaissance par id/type, même ordre et mêmes exclusions que `applyMagelianStyle`. Toute autre couche
 * (posée par l'application) est laissée intacte. Une propriété absente d'une couche est ignorée, comme React.
 */
export function appliquerStyleMagelian(
  carte: CarteStyleMagelian, c: PaletteStyleMagelian, couchesFond: ReadonlySet<string>,
): void {
  const style = carte.getStyle();
  if (!style?.layers) return;
  for (const couche of style.layers) {
    if (!couchesFond.has(couche.id)) continue;
    const id = couche.id.toLowerCase();
    const type = couche.type;
    const peindre = (propriete: string, valeur: unknown) => carte.setPaintProperty(couche.id, propriete, valeur);
    try {
      if (type === 'background') { peindre('background-color', c.fond); continue; }

      if (type === 'fill' && (id.includes('water') || id.includes('ocean') || id.includes('sea'))) {
        peindre('fill-color', c.eau);
        continue;
      }
      if (type === 'line' && id.includes('water')) { peindre('line-color', c.contourEau); continue; }

      if (type === 'fill' && (id.includes('land') || id.includes('park') || id.includes('grass') || id.includes('wood') || id.includes('green'))) {
        peindre('fill-color', id.includes('use') ? c.occupationSol : c.sol);
        continue;
      }

      if (type === 'fill' && id.includes('building')) { peindre('fill-color', c.batiment); continue; }
      if (type === 'line' && id.includes('building')) { peindre('line-color', c.contourBatiment); continue; }

      if (type === 'line' && (id.includes('road') || id.includes('highway') || id.includes('street') || id.includes('trunk') || id.includes('motorway') || id.includes('path') || id.includes('track'))) {
        if (id.includes('highway') || id.includes('motorway') || id.includes('trunk')) peindre('line-color', c.autoroute);
        else if (id.includes('major') || id.includes('primary') || id.includes('secondary')) peindre('line-color', c.routePrincipale);
        else peindre('line-color', c.routeSecondaire);
        continue;
      }

      if (type === 'fill' && (id.includes('road') || id.includes('highway'))) { peindre('fill-color', c.routeSecondaire); continue; }

      if (type === 'line' && (id.includes('boundary') || id.includes('border') || id.includes('admin'))) {
        peindre('line-color', c.frontiere);
        peindre('line-dasharray', [4, 2]);
        continue;
      }

      if (type === 'symbol') {
        if (id.includes('country') || id.includes('state') || id.includes('region') || id.includes('province')) {
          peindre('text-color', c.libelleRegion);
        } else if (id.includes('city') || id.includes('town') || id.includes('place') || id.includes('capital')) {
          peindre('text-color', c.libelleVille);
        } else {
          peindre('text-color', c.libelleMineur);
        }
        peindre('text-halo-color', c.haloLibelle);
        peindre('text-halo-width', 1.5);
        continue;
      }

      if (type === 'fill' && !['isochrone', 'voronoi', 'battle', 'zone', 'carreaux', 'iris', 'cluster', 'poi'].some((m) => id.includes(m))) {
        peindre('fill-color', c.sol);
      }
    } catch {
      // Certaines propriétés n'existent pas sur certaines couches — ignorées, comme React.
    }
  }
}

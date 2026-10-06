/**
 * Le fond « MAGELIAN » — portage de `applyMagelianStyle` (`lib/map/magelian-style.ts`), appliqué sur le
 * style Positron au `load` et ré-appliqué à chaque bascule de thème (`useMapInit.ts:217-221,1091-1102`).
 *
 * ── COULEURS PAR JETONS, JAMAIS DE HEX ───────────────────────────────────
 * React tenait deux tables d'hexadécimaux (`MAGELIAN_PALETTE.dark` / `.light`). Ici chaque rôle est un
 * JETON de `styles/jetons.css`, lu par `CouleursService.palette(JETONS_STYLE_MAGELIAN)` — un `Signal` qui
 * suit le thème, donc le fond suit la bascule sans table recopiée. MapLibre ne résout pas `var()` dans
 * `paint` : la fonction reçoit des valeurs CALCULÉES.
 *
 * Correspondance retenue (rôle React → jeton) : les jetons existants ne reprennent pas toutes les teintes
 * de React — aucun jeton n'est inventé (`jetons.css` ne peut rien porter qu'`app/globals.css` n'ait déjà).
 * Le thème SOMBRE retombe exactement sur React pour 11 rôles sur 15 ; l'écart est listé dans le rapport T4.
 *
 * | rôle React      | sombre React | clair React | jeton             |
 * |-----------------|--------------|-------------|-------------------|
 * | background      | #0a0a0a      | #f5f5f5     | bg-level-1        |
 * | water           | #050505      | #e6eff5     | bg-level-0        |
 * | waterStroke     | #1a1a1a      | #c8d8e3     | border-subtle     |
 * | land            | #0a0a0a      | #f5f5f5     | bg-level-1        |
 * | landuse         | #0d0d0d      | #eeeeee     | bg-level-2        |
 * | building        | #111111      | #e2e2e2     | bg-level-2        |
 * | buildingStroke  | #1a1a1a      | #d0d0d0     | border-subtle     |
 * | roadMajor       | #262626      | #c4c4c4     | border-default    |
 * | roadMinor       | #1a1a1a      | #dcdcdc     | border-subtle     |
 * | roadHighway     | #333333      | #a6a6a6     | border-hover      |
 * | border          | #262626      | #bbbbbb     | border-default    |
 * | labelCity       | #666666      | #4a4a4a     | text-tertiary     |
 * | labelRegion     | teal 0,35    | teal 0,6    | brand-teal-30     |
 * | labelHalo       | #050505      | #ffffff     | bg-level-0        |
 * | labelMinor      | #333333      | #8a8a8a     | border-hover      |
 * (`park` n'est lu par aucune règle de React : il n'est pas repris.)
 */

/** Les rôles du fond MAGELIAN et le jeton qui porte chacun (voir la table ci-dessus). */
export const JETONS_STYLE_MAGELIAN = {
  fond: 'bg-level-1',
  eau: 'bg-level-0',
  contourEau: 'border-subtle',
  sol: 'bg-level-1',
  occupationSol: 'bg-level-2',
  batiment: 'bg-level-2',
  contourBatiment: 'border-subtle',
  routePrincipale: 'border-default',
  routeSecondaire: 'border-subtle',
  autoroute: 'border-hover',
  frontiere: 'border-default',
  libelleVille: 'text-tertiary',
  libelleRegion: 'brand-teal-30',
  haloLibelle: 'bg-level-0',
  libelleMineur: 'border-hover',
} as const;

export type PaletteStyleMagelian = Record<keyof typeof JETONS_STYLE_MAGELIAN, string>;

/** La surface de carte employée — de quoi lire les couches du style et les repeindre. */
export interface CarteStyleMagelian {
  getStyle(): { layers?: { id: string; type: string }[] } | undefined;
  setPaintProperty(couche: string, propriete: string, valeur: unknown): unknown;
}

/**
 * Repeint chaque couche du style chargé — mêmes règles de reconnaissance par id/type, même ordre et mêmes
 * exclusions que `applyMagelianStyle`. Une propriété absente d'une couche est ignorée, comme React.
 */
export function appliquerStyleMagelian(carte: CarteStyleMagelian, c: PaletteStyleMagelian): void {
  const style = carte.getStyle();
  if (!style?.layers) return;
  for (const couche of style.layers) {
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

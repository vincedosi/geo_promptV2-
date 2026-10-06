import { JETONS_STYLE_MAGELIAN, type PaletteStyleMagelian, appliquerStyleMagelian, couchesDuFond } from './style-magelian';

/** Une palette sentinelle : chaque rôle porte une valeur reconnaissable, comme le rendrait `CouleursService`. */
const PALETTE = Object.fromEntries(
  Object.keys(JETONS_STYLE_MAGELIAN).map((cle, i) => [cle, `rgb(${i}, ${i}, ${i})`]),
) as PaletteStyleMagelian;

/** Couches représentatives du style Positron (ids réels d'OpenFreeMap). */
const COUCHES = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill' },
  { id: 'waterway', type: 'line' },
  { id: 'landcover_wood', type: 'fill' },
  { id: 'landuse_residential', type: 'fill' },
  { id: 'building', type: 'fill' },
  { id: 'highway_motorway_inner', type: 'line' },
  { id: 'highway_major_inner', type: 'line' },
  { id: 'highway_minor', type: 'line' },
  { id: 'road_path', type: 'line' },
  { id: 'boundary_country', type: 'line' },
  { id: 'place_country_major', type: 'symbol' },
  { id: 'place_city', type: 'symbol' },
  { id: 'highway_name_other', type: 'symbol' },
  { id: 'aeroway-area', type: 'fill' },
];

/** Le style de fond seul : ce que `couchesDuFond` relève au `load`. */
const FOND = new Set(COUCHES.map((c) => c.id));

function carte(couches = COUCHES) {
  const peintures: { couche: string; propriete: string; valeur: unknown }[] = [];
  return {
    peintures,
    getStyle: () => ({ layers: couches }),
    setPaintProperty: (couche: string, propriete: string, valeur: unknown) => { peintures.push({ couche, propriete, valeur }); },
  };
}

const valeur = (c: ReturnType<typeof carte>, couche: string, propriete: string) =>
  c.peintures.find((p) => p.couche === couche && p.propriete === propriete)?.valeur;

describe('appliquerStyleMagelian — portage de applyMagelianStyle', () => {
  it('ne peint QUE des valeurs issues de la palette (ou des constantes de forme), jamais une chaîne var(', () => {
    const c = carte();
    appliquerStyleMagelian(c, PALETTE, FOND);
    expect(c.peintures.length).toBeGreaterThan(0);
    const couleurs = new Set(Object.values(PALETTE));
    for (const p of c.peintures) {
      expect(JSON.stringify(p.valeur)).not.toContain('var(');
      if (typeof p.valeur === 'string') expect(couleurs.has(p.valeur), `${p.couche}.${p.propriete}`).toBe(true);
    }
  });

  it('reprend les règles de reconnaissance de React, rôle par rôle', () => {
    const c = carte();
    appliquerStyleMagelian(c, PALETTE, FOND);
    expect(valeur(c, 'background', 'background-color')).toBe(PALETTE.fond);
    expect(valeur(c, 'water', 'fill-color')).toBe(PALETTE.eau);
    expect(valeur(c, 'waterway', 'line-color')).toBe(PALETTE.contourEau);
    expect(valeur(c, 'landcover_wood', 'fill-color')).toBe(PALETTE.sol);
    expect(valeur(c, 'landuse_residential', 'fill-color')).toBe(PALETTE.occupationSol);
    expect(valeur(c, 'building', 'fill-color')).toBe(PALETTE.batiment);
    expect(valeur(c, 'highway_motorway_inner', 'line-color')).toBe(PALETTE.autoroute);
    // « highway_major » contient « highway » : React le peint en autoroute (premier test gagnant) — parité.
    expect(valeur(c, 'highway_major_inner', 'line-color')).toBe(PALETTE.autoroute);
    expect(valeur(c, 'road_path', 'line-color')).toBe(PALETTE.routeSecondaire);
    expect(valeur(c, 'boundary_country', 'line-color')).toBe(PALETTE.frontiere);
    expect(valeur(c, 'boundary_country', 'line-dasharray')).toEqual([4, 2]);
    expect(valeur(c, 'place_country_major', 'text-color')).toBe(PALETTE.libelleRegion);
    expect(valeur(c, 'place_city', 'text-color')).toBe(PALETTE.libelleVille);
    expect(valeur(c, 'highway_name_other', 'text-color')).toBe(PALETTE.libelleMineur);
    expect(valeur(c, 'place_city', 'text-halo-color')).toBe(PALETTE.haloLibelle);
    expect(valeur(c, 'place_city', 'text-halo-width')).toBe(1.5);
    expect(valeur(c, 'aeroway-area', 'fill-color')).toBe(PALETTE.sol);
  });

  it("ne repeint QUE les couches du fond : une couche de données posée ensuite (fill, symbol, line) reste intacte", () => {
    const donnees = [
      { id: 'meteo-fill', type: 'fill' },
      { id: 'radio-coverage-fill', type: 'fill' },
      { id: 'zones-etiquettes', type: 'symbol' },
      { id: 'admin-contour-zone', type: 'line' },
      { id: 'carreaux-fill', type: 'fill' },
    ];
    const c = carte([...COUCHES, ...donnees]);
    appliquerStyleMagelian(c, PALETTE, FOND);
    for (const d of donnees) expect(c.peintures.some((p) => p.couche === d.id), d.id).toBe(false);
    expect(valeur(c, 'background', 'background-color')).toBe(PALETTE.fond);
  });

  it("couchesDuFond relève les ids du style chargé (rien si le style ne l'est pas)", () => {
    expect([...couchesDuFond(carte())]).toEqual(COUCHES.map((x) => x.id));
    expect(couchesDuFond({ getStyle: () => undefined, setPaintProperty: () => undefined }).size).toBe(0);
  });

  it('chaque rôle pointe vers un jeton dédié --carte-magelian-*', () => {
    for (const jeton of Object.values(JETONS_STYLE_MAGELIAN)) expect(jeton).toMatch(/^carte-magelian-[a-z-]+$/);
  });

  it('style non chargé : rien, sans lever ; propriété refusée par une couche : ignorée', () => {
    expect(() => appliquerStyleMagelian({ getStyle: () => undefined, setPaintProperty: () => { throw new Error('x'); } }, PALETTE, FOND)).not.toThrow();
    const leve = { getStyle: () => ({ layers: COUCHES }), setPaintProperty: () => { throw new Error('refus'); } };
    expect(() => appliquerStyleMagelian(leve, PALETTE, FOND)).not.toThrow();
  });
});

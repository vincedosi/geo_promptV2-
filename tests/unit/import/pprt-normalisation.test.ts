/**
 * Table de vérité de la normalisation des périmètres PPRT.
 *
 * Chaque cas vient d'une valeur RÉELLEMENT observée dans les 664 lignes du WFS
 * `wfs_sup:assiette_sup_s` (filtre `suptype='pm3'`) le 2026-09-17, avec son
 * effectif. Aucun cas inventé : c'est ce qui rend ce fichier utile quand la
 * source changera.
 */
import { describe, it, expect } from 'vitest';
import {
  normaliserTypeZone,
  depotDePartition,
  nomLisible,
  refZonePprt,
  normaliserZonePprt,
  SOURCE_PPRT,
} from '@/lib/import/pprt/normalisation';

describe('normaliserTypeZone — six orthographes, deux familles', () => {
  it.each([
    // libellé brut, effectif mesuré, famille attendue
    ['Enveloppe des zonages réglementaires', 633, 'enveloppe'],
    ['Enveloppe des zonages reglementaires', 5, 'enveloppe'],
    ['Enveloppe des zonages règlementaires', 1, 'enveloppe'],
    ['Périmètre réglementé du PPR', 10, 'perimetre_reglemente'],
    ['Pï¿½rimï¿½tre rï¿½glementï¿½ du PPR', 8, 'perimetre_reglemente'],
    ['24', 7, 'indetermine'],
  ] as const)('%s (%d lignes) -> %s', (brut, _n, attendu) => {
    expect(normaliserTypeZone(brut)).toBe(attendu);
  });

  it('les 664 lignes se répartissent en 639 enveloppes, 18 périmètres, 7 indéterminés', () => {
    const observe: Array<[string, number]> = [
      ['Enveloppe des zonages réglementaires', 633],
      ['Enveloppe des zonages reglementaires', 5],
      ['Enveloppe des zonages règlementaires', 1],
      ['Périmètre réglementé du PPR', 10],
      ['Pï¿½rimï¿½tre rï¿½glementï¿½ du PPR', 8],
      ['24', 7],
    ];
    const total = { enveloppe: 0, perimetre_reglemente: 0, indetermine: 0 };
    for (const [brut, n] of observe) total[normaliserTypeZone(brut)] += n;

    expect(total).toEqual({ enveloppe: 639, perimetre_reglemente: 18, indetermine: 7 });
    expect(observe.reduce((s, [, n]) => s + n, 0)).toBe(664);
  });

  it("le mojibake garde un `i` la ou l'accent est perdu — c'est ce qui rend le squelette matchable", () => {
    // `ï` (U+00EF) se déplie en NFD en `i` + tréma ; `¿` et `½` disparaissent.
    // Un squelette calculé sans tenir compte de ce `i` résiduel ne filtrerait
    // pas, et ces 8 zones tomberaient en `indetermine`.
    expect(normaliserTypeZone('Pï¿½rimï¿½tre rï¿½glementï¿½ du PPR')).not.toBe('indetermine');
  });

  it.each([null, undefined, '', '   '])('une valeur absente (%s) est indeterminee, jamais devinee', (v) => {
    expect(normaliserTypeZone(v)).toBe('indetermine');
  });
});

describe("depotDePartition — le piege regional de cette source", () => {
  it.each([
    ['130010366_SUP_62_PM3', 'departement', '62'],
    ['130013915_SUP_971_PM3', 'departement', '971'],
    ['130010739_SUP_71_PM3', 'departement', '71'],
    ['130008634_SUP_18_PM3', 'departement', '18'],
    ['172014607_SUP_29_AC4', 'departement', '29'],
  ] as const)('%s -> depot %s %s', (partition, niveau, code) => {
    expect(depotDePartition(partition)).toEqual({ niveau, code });
  });

  it.each([
    // Les 5 depots regionaux reellement mesures, et leurs 77 zones.
    ['130006091_SUP_R76_PM3', '76', 33],
    ['130006109_SUP_R52_PM3', '52', 16],
    ['130006265_SUP_R28_PM3', '28', 20],
    ['130006596_SUP_R94_PM3', '94', 6],
    ['130014236_SUP_R02_PM3', '02', 2],
  ] as const)('%s est un depot REGIONAL (region %s, %d zones)', (partition, code, _zones) => {
    expect(depotDePartition(partition)).toEqual({ niveau: 'region', code });
  });

  it('ne confond jamais un code region avec un code departement', () => {
    // Le defaut a corriger : `R76` lu comme `76` ferait passer 33 zones
    // d'Occitanie pour de la Seine-Maritime. Les deux nomenclatures INSEE se
    // recouvrent — 76 designe Occitanie ET la Seine-Maritime.
    const regional = depotDePartition('130006091_SUP_R76_PM3');
    const departemental = depotDePartition('130006265_SUP_76_PM3');
    expect(regional).toEqual({ niveau: 'region', code: '76' });
    expect(departemental).toEqual({ niveau: 'departement', code: '76' });
    expect(regional).not.toEqual(departemental);
  });

  it('accepte la Corse, que le referentiel ecrit 2A/2B et non 20', () => {
    expect(depotDePartition('130000000_SUP_2A_PM3')).toEqual({ niveau: 'departement', code: '2A' });
    expect(depotDePartition('130000000_SUP_2b_PM3')).toEqual({ niveau: 'departement', code: '2B' });
  });

  it.each([null, undefined, '', 'nimportequoi', '130010366_PM3'])(
    'rend null plutot que de fabriquer un echelon (%s)',
    (v) => {
      expect(depotDePartition(v)).toBeNull();
    },
  );
});

describe('nomLisible — le libelle manque sur 202 des 664 lignes', () => {
  it("prefere le libelle de l'editeur quand il existe", () => {
    expect(nomLisible('PPRT ARCELOR MITTAL', 'PM3_pprt-am_ass')).toBe('PPRT ARCELOR MITTAL');
  });

  it("garde le titre de l'arrete tel quel : c'est le seul texte redige par quelqu'un", () => {
    const litt = "Arrêté d'approbation du PPRT de la société LOGISTINORD";
    expect(nomLisible(litt, 'PM3_pprt-logistinord_ass')).toBe(litt);
  });

  it.each([
    ['PM3_pprt-logistinord_ass', 'pprt-logistinord'],
    ['PM3_AZELIS PEROXYDES_ BIOXAL TECHNIC ALEM_ass', 'AZELIS PEROXYDES BIOXAL TECHNIC ALEM'],
    ['PM3_PointeJarry_ass', 'PointeJarry'],
    ['PM3_PPRT_TITANOBEL_ass', 'PPRT TITANOBEL'],
    ['PM3_ENTREPRISE BUTAGAZ_ass', 'ENTREPRISE BUTAGAZ'],
  ])('degrossit %s -> %s', (nomass, attendu) => {
    expect(nomLisible(null, nomass)).toBe(attendu);
  });

  it('ne rend jamais une chaine vide, qui afficherait une popup sans titre', () => {
    expect(nomLisible(null, null)).toBe('PPRT sans libellé');
    expect(nomLisible('  ', 'PM3__ass')).toBe('PPRT sans libellé');
  });
});

describe("refZonePprt — pourquoi `idass` ne peut pas servir de cle", () => {
  const geoA = [[[[2.5, 47.0], [2.6, 47.0], [2.6, 47.1], [2.5, 47.0]]]];
  const geoB = [[[[4.8, 43.4], [4.9, 43.4], [4.9, 43.5], [4.8, 43.4]]]];

  it('deux PPRT partageant le meme idass corrompu obtiennent deux cles distinctes', () => {
    // Mesuré : `idass = 2147483647` (INT32_MAX) est porté par QUATRE PPRT sans
    // rapport. La clé ne le regarde pas, donc ils ne se télescopent pas.
    const a = refZonePprt('130013915_SUP_971_PM3', 'PM3_PointeJarry_ass', geoA);
    const b = refZonePprt('130010739_SUP_71_PM3', 'PM3_ENTREPRISE BUTAGAZ_ass', geoB);
    expect(a).not.toBe(b);
  });

  it("deux zones d'un MEME PPRT (meme partition, meme nomass) restent distinctes par leur trace", () => {
    // Mesuré : AXEREAL dans le Cher a 7 lignes au même couple partition+nomass.
    const a = refZonePprt('130008634_SUP_18_PM3', 'PM3_AXEREAL_ass', geoA);
    const b = refZonePprt('130008634_SUP_18_PM3', 'PM3_AXEREAL_ass', geoB);
    expect(a).not.toBe(b);
  });

  it('est stable : le meme flux reimporte rend la meme cle', () => {
    const args = ['130008634_SUP_18_PM3', 'PM3_AXEREAL_ass', geoA] as const;
    expect(refZonePprt(...args)).toBe(refZonePprt(...args));
  });
});

describe('normaliserZonePprt', () => {
  const feature = {
    geometry: { type: 'MultiPolygon', coordinates: [[[[4.88, 43.43], [4.89, 43.43], [4.89, 43.44], [4.88, 43.43]]]] },
    properties: {
      partition: '130010135_SUP_13_PM3',
      nomass: 'PM3_ARCELOR_ass',
      nomsuplitt: 'PPRT ARCELOR MITTAL',
      typeass: 'Enveloppe des zonages réglementaires',
      idgen: 'PM3-130010135-8-1',
      idass: 'PM3-130010135-8-1-1',
      gpu_doc_id: 'dbab820e18fcf7bdfa4024f3ebdf12f0',
      gpu_timestamp: '2025-07-04T12:00:10.317Z',
      fichier: 'PM3_pprt-arcelor_20101203_act.pdf',
      modegeoass: 'Égale au générateur',
    },
  };

  it('rend une ligne complete et un id deterministe', () => {
    const l = normaliserZonePprt(feature)!;
    expect(l).not.toBeNull();
    expect(l.nom).toBe('PPRT ARCELOR MITTAL');
    expect(l.type_zone).toBe('enveloppe');
    expect(l.depot_niveau).toBe('departement');
    expect(l.depot_code).toBe('13');
    expect(l.id_generateur).toBe('PM3-130010135-8-1');
    expect(l.source).toBe(SOURCE_PPRT);
    expect(l.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(normaliserZonePprt(feature)!.id).toBe(l.id);
  });

  it('conserve la valeur brute du type, meme quand elle est inexploitable', () => {
    const l = normaliserZonePprt({
      ...feature,
      properties: { ...feature.properties, typeass: '24' },
    })!;
    expect(l.type_zone).toBe('indetermine');
    expect(l.type_zone_source).toBe('24');
  });

  it('accepte un Polygon simple autant qu un MultiPolygon', () => {
    const l = normaliserZonePprt({
      ...feature,
      geometry: { type: 'Polygon', coordinates: [[[4.88, 43.43], [4.89, 43.43], [4.89, 43.44], [4.88, 43.43]]] },
    });
    expect(l).not.toBeNull();
  });

  it.each([
    ['geometrie absente', { ...feature, geometry: null }],
    ['geometrie non surfacique', { ...feature, geometry: { type: 'Point', coordinates: [4.88, 43.43] } }],
    ['coordonnees absentes', { ...feature, geometry: { type: 'MultiPolygon', coordinates: null } }],
    ['partition absente', { ...feature, properties: { ...feature.properties, partition: null } }],
  ])('refuse une feature sans %s, plutot que d ecrire un perimetre qui n en est pas un', (_libelle, f) => {
    expect(normaliserZonePprt(f as never)).toBeNull();
  });
});

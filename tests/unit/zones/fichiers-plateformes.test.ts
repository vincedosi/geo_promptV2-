/**
 * Les fichiers par plateforme d'une extraction (lot 7, T2, A-6) : formats offerts, CSV, GeoJSON, et la
 * caractérisation des deux textes DV360 extraits de l'export de zone (`custom-geo/[id]/export`, `dv360_cp`,
 * `dv360_sdf`).
 */
import { describe, expect, it } from 'vitest';
import { texteCpDv360, texteSdfDv360 } from '@/lib/digital/fichiers-dv360';
import { EN_TETES_CSV, choisirBloc, fichierPlateforme, formatsDe, type EnteteFichier, type UniteFichier } from '@/lib/zones/fichiers-plateformes';

/**
 * RÉFÉRENCES écrites AVANT l'extraction, depuis le corps de l'export de zone tel qu'il était (référentiel geotargets
 * 2026-06-15 : 13001 → 9054999, 75001 → 9056126, 00000 sans geo ID). Elles ne se régénèrent pas : si elles changent,
 * l'export de zone a changé.
 */
const CPS = ['13001', '75001', '00000'];
const REF_CP = '13001\n75001\n00000';
const REF_SDF = [
  'Zone : Zone essai',
  'Référentiel geotargets Google 2026-06-15 — 2 CP mappés sur 3',
  '',
  'Geography Targeting - Include (à coller dans le SDF Line Items) :',
  '(9054999; 9056126;)',
  '',
  'Codes postaux sans geo ID Google (1, à cibler manuellement) :',
  '00000',
].join('\n');

const unite = (u: Partial<UniteFichier>): UniteFichier =>
  ({ ordinal: 1, code: null, nom: null, centre: null, rayon_m: null, retenu: true, ...u });
const entete = (e: Partial<EnteteFichier>): EnteteFichier =>
  ({ jeu: 'Lycées 5 km — BdR', version: 1, plateforme: 'meta', maille: 'cercle', aVerifier: false, releveLe: '2026-10-14', ...e });
const lignesDonnees = (contenu: string) => contenu.replace(/^﻿/, '').split('\n').filter((l) => !l.startsWith('#'));

describe('formatsDe', () => {
  it('un format par (plateforme, maille)', () => {
    expect(formatsDe('dv360', 'cp')).toEqual(['cp', 'sdf']);
    expect(formatsDe('ttd', 'polygone')).toEqual(['polygone']);
    expect(formatsDe('meta', 'cercle')).toEqual(['cercles']);
    expect(formatsDe('tiktok', 'departement')).toEqual(['territoires']);
    expect(formatsDe('tiktok', 'commune')).toEqual(['territoires']);
    expect(formatsDe('meta', 'cp')).toEqual(['cp']);
    expect(formatsDe('dv360', 'iris')).toEqual([]);
  });
});

describe('textes DV360 (caractérisation de l’export de zone)', () => {
  it('texteCpDv360 et texteSdfDv360 rendent exactement la référence', () => {
    expect(texteCpDv360(CPS)).toBe(REF_CP);
    expect(texteSdfDv360('Zone essai', CPS)).toBe(REF_SDF);
    expect(texteSdfDv360('Vide', ['00000'])).toContain('(aucun geo ID mappé)');
  });
  it('les fichiers DV360 d’une extraction : ces mêmes textes, sans BOM ni en-tête', () => {
    const unites = CPS.map((code, i) => unite({ ordinal: i + 1, code }));
    const cp = fichierPlateforme(entete({ plateforme: 'dv360', maille: 'cp' }), unites, null, 'cp');
    expect(cp).toEqual({ nom: 'extraction_lycees-5-km-bdr_v1_dv360_cp.txt', type: 'text/plain; charset=utf-8', contenu: REF_CP });
    const sdf = fichierPlateforme(entete({ plateforme: 'dv360', maille: 'cp' }), unites, null, 'sdf');
    expect(sdf.contenu).toBe(texteSdfDv360('Lycées 5 km — BdR — extraction v1', CPS));
    expect(sdf.contenu).toContain('Geography Targeting - Include');
  });
});

describe('fichierPlateforme — CSV', () => {
  it('cercles : en-tête, 6 décimales, 5 000 m → 5, seules les unités retenues, BOM, méthode', () => {
    const f = fichierPlateforme(entete({}), [
      unite({ ordinal: 1, centre: { type: 'Point', coordinates: [5.42732, 43.284307] }, rayon_m: 5000 }),
      unite({ ordinal: 2, nom: 'Nord; bis', centre: { type: 'Point', coordinates: [5.1, 43.5] }, rayon_m: 1500 }),
      unite({ ordinal: 3, centre: { type: 'Point', coordinates: [5, 43] }, rayon_m: 5000, retenu: false }),
    ], null, 'cercles');
    expect(f.nom).toBe('extraction_lycees-5-km-bdr_v1_meta_cercles.csv');
    expect(f.type).toBe('text/csv; charset=utf-8');
    expect(f.contenu.startsWith('﻿# Jeu : Lycées 5 km — BdR\n')).toBe(true);
    expect(f.contenu).toContain('# Maille : cercle');
    expect(f.contenu).toContain('# Relevé des limites de la plateforme : 2026-10-14');
    expect(f.contenu).not.toContain('À vérifier');
    expect(lignesDonnees(f.contenu)).toEqual([
      EN_TETES_CSV.cercles,
      'Cercle 1;43.284307;5.427320;5',
      '"Nord; bis";43.500000;5.100000;1.5',
    ]);
  });
  it('date de relevé inconnue : la ligne « Relevé » est omise, jamais écrite vide', () => {
    const f = fichierPlateforme(entete({ releveLe: null }), [unite({ ordinal: 1, rayon_m: 5000,
      centre: { type: 'Point', coordinates: [5, 43] } })], null, 'cercles');
    expect(f.contenu).not.toContain('Relevé');
    expect(f.contenu).toContain('# Maille : cercle');
  });
  it('« à vérifier » dit dans la méthode ; Meta au CP préfixé `FR:` ; TTD au CP brut', () => {
    const unites = [unite({ code: '13001' }), unite({ code: '13002', retenu: false })];
    const meta = fichierPlateforme(entete({ maille: 'cp', aVerifier: true }), unites, null, 'cp');
    expect(meta.contenu).toContain('# À vérifier');
    expect(lignesDonnees(meta.contenu)).toEqual(['code_postal', 'FR:13001']);
    const ttd = fichierPlateforme(entete({ plateforme: 'ttd', maille: 'cp' }), unites, null, 'cp');
    expect(lignesDonnees(ttd.contenu)).toEqual(['code_postal', '13001']);
  });
  it('revue T6 (I-8) : les paramètres « à vérifier » figés et la réserve « France entière » se disent dans la méthode', () => {
    const f = fichierPlateforme(entete({ plateforme: 'dv360', maille: 'pays', parametresAVerifier: ['max_unites', 'poids_groupe_cp'], paysAVerifier: true }),
      [{ ordinal: 1, code: 'FR', nom: 'France', centre: null, rayon_m: null, retenu: true }], null, 'pays');
    expect(f.contenu).toContain('# À vérifier, paramètres : nombre d’unités par liste, poids d’un groupe de codes postaux');
    expect(f.contenu).toContain('# À vérifier : France entière : le ciblage des DROM comme pays distincts (GP, MQ, GF, RE, YT) n’est pas encore confirmé dans un compte.');
    const g = JSON.parse(fichierPlateforme(entete({ plateforme: 'ttd', maille: 'polygone', parametresAVerifier: ['polygone_sommets_max'] }), [], { type: 'Point', coordinates: [0, 0] }, 'polygone').contenu);
    expect(g.features[0].properties.methode).toMatchObject({ parametres_a_verifier: ['polygone_sommets_max'], pays_a_verifier: false });
  });

  it('territoires : `code;nom` des unités retenues', () => {
    const f = fichierPlateforme(entete({ plateforme: 'tiktok', maille: 'departement' }), [
      unite({ code: '13', nom: 'Bouches-du-Rhône' }), unite({ ordinal: 2, code: '30', nom: 'Gard', retenu: false }),
    ], null, 'territoires');
    expect(lignesDonnees(f.contenu)).toEqual([EN_TETES_CSV.territoires, '13;Bouches-du-Rhône']);
  });
  it('un cercle sans centre lève (jamais un fichier incomplet en silence) ; un format sans objet aussi', () => {
    expect(() => fichierPlateforme(entete({}), [unite({ rayon_m: 5000 })], null, 'cercles')).toThrow();
    expect(() => fichierPlateforme(entete({}), [], null, 'cp')).toThrow();
  });
});

describe('fichierPlateforme — GeoJSON', () => {
  it('une FeatureCollection d’une Feature, la forme en géométrie, la méthode en propriété', () => {
    const forme = { type: 'MultiPolygon', coordinates: [[[[5, 43], [5.1, 43], [5.1, 43.1], [5, 43]]]] };
    const f = fichierPlateforme(entete({ plateforme: 'ttd', maille: 'polygone', aVerifier: true }), [], forme, 'polygone');
    expect(f.nom).toBe('extraction_lycees-5-km-bdr_v1_ttd_polygone.geojson');
    expect(f.type).toBe('application/geo+json; charset=utf-8');
    const gj = JSON.parse(f.contenu);
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features).toHaveLength(1);
    expect(gj.features[0]).toMatchObject({
      type: 'Feature', geometry: forme,
      properties: { methode: { jeu: 'Lycées 5 km — BdR', version: 1, plateforme: 'ttd', maille: 'polygone', a_verifier: true } },
    });
  });
});

describe('le fichier « pays » d’une extraction nationale (⑤ finitions, T3, A-7)', () => {
  const PAYS = [
    unite({ ordinal: 1, code: 'FR', nom: 'France' }), unite({ ordinal: 2, code: 'GP', nom: 'Guadeloupe' }),
    unite({ ordinal: 3, code: 'MQ', nom: 'Martinique' }),
  ];
  it('formatsDe(p, pays) = [pays] pour les quatre plateformes', () => {
    for (const p of ['dv360', 'ttd', 'meta', 'tiktok'] as const) expect(formatsDe(p, 'pays'), p).toEqual(['pays']);
  });
  it('CSV `code_pays;nom` à BOM, méthode, consigne de réglage, « à vérifier » pour TTD', () => {
    const f = fichierPlateforme(entete({ plateforme: 'ttd', maille: 'pays', aVerifier: true, releveLe: '2026-10-30' }), PAYS, null, 'pays');
    expect(f.nom).toBe('extraction_lycees-5-km-bdr_v1_ttd_pays.csv');
    expect(f.type).toBe('text/csv; charset=utf-8');
    expect(f.contenu.startsWith('﻿# Jeu : Lycées 5 km — BdR\n')).toBe(true);
    const lignes = f.contenu.replace(/^﻿/, '').split('\n');
    expect(lignes.filter((l) => l.startsWith('#'))).toEqual([
      '# Jeu : Lycées 5 km — BdR',
      '# Extraction : v1',
      '# Plateforme : ttd',
      '# Maille : pays',
      '# Relevé des limites de la plateforme : 2026-10-30',
      '# À vérifier : la règle de ciblage de cette plateforme n’a pas été confirmée sur sa documentation.',
      '# Réglage : ciblage par pays, à poser dans la plateforme (aucune liste de lieux à téléverser)',
    ]);
    expect(EN_TETES_CSV.pays).toBe('code_pays;nom');
    expect(lignesDonnees(f.contenu)).toEqual(['code_pays;nom', 'FR;France', 'GP;Guadeloupe', 'MQ;Martinique']);
  });
  it('seules les unités retenues ; Meta sans « à vérifier »', () => {
    const f = fichierPlateforme(entete({ plateforme: 'meta', maille: 'pays' }), [...PAYS.slice(0, 1), unite({ ordinal: 2, code: 'GP', nom: 'Guadeloupe', retenu: false })], null, 'pays');
    expect(lignesDonnees(f.contenu)).toEqual(['code_pays;nom', 'FR;France']);
    expect(f.contenu).not.toContain('À vérifier');
  });
  it('le format pays ne s’applique qu’à la maille pays, et une maille pays n’a pas d’autre format', () => {
    expect(() => fichierPlateforme(entete({ maille: 'cp' }), PAYS, null, 'pays')).toThrow(/sans objet/);
    expect(() => fichierPlateforme(entete({ maille: 'pays' }), PAYS, null, 'cp')).toThrow(/sans objet/);
  });
});

describe('B14 round 1 (I-2) — le fichier suit les blocs du découpage', () => {
  // 3 500 communes : 3 000 au bloc 1, 500 au bloc 2 (`zone_set_extraction_unites.bloc`), et une non retenue.
  const unites = [
    ...Array.from({ length: 3500 }, (_, i) => unite({ ordinal: i + 1, code: String(10000 + i), nom: `C${i}`, bloc: i < 3000 ? 1 : 2 })),
    unite({ ordinal: 3501, code: '99999', nom: 'Hors', retenu: false }),
  ];
  const tiktok = entete({ plateforme: 'tiktok', maille: 'commune' });

  it('3 500 communes : deux fichiers, de 3 000 puis 500 lignes, chacun dit son bloc', () => {
    for (const [numero, n] of [[1, 3000], [2, 500]] as const) {
      const c = choisirBloc(unites, numero);
      expect(c).toEqual({ ok: true, bloc: { numero, total: 2 } });
      const f = fichierPlateforme({ ...tiktok, ...(c.ok ? { bloc: c.bloc } : {}) }, unites, null, 'territoires');
      expect(lignesDonnees(f.contenu)).toHaveLength(n + 1);
      expect(f.contenu).toContain(`# Bloc : ${numero} sur 2`);
      expect(f.nom).toMatch(new RegExp(`_tiktok_territoires_bloc${numero}\.csv$`));
    }
  });
  it('sans bloc demandé alors qu’il y en a deux : 422, la liste des blocs — jamais un fichier au-dessus de la limite', () => {
    const c = choisirBloc(unites, undefined);
    expect(c).toMatchObject({ ok: false, status: 422, blocs: [{ numero: 1, n_unites: 3000 }, { numero: 2, n_unites: 500 }] });
    expect(!c.ok && c.error.replace(/\s/g, ' ')).toBe('Cette extraction est découpée en 2 blocs (3 000 + 500) : téléchargez chaque bloc (bloc=1 à 2).');
  });
  it('un bloc absent : 404 ; un bloc demandé sans découpage : 400 ; sans découpage ni bloc : le fichier entier', () => {
    expect(choisirBloc(unites, 3)).toMatchObject({ ok: false, status: 404 });
    const simples = [unite({ code: '13', nom: 'BdR' })];
    expect(choisirBloc(simples, 1)).toMatchObject({ ok: false, status: 400 });
    expect(choisirBloc(simples, undefined)).toEqual({ ok: true });
  });
});

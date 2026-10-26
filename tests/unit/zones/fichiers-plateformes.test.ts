/**
 * Les fichiers par plateforme d'une extraction (lot 7, T2, A-6) : formats offerts, CSV, GeoJSON, et la
 * caractérisation des deux textes DV360 extraits de l'export de zone (`custom-geo/[id]/export`, `dv360_cp`,
 * `dv360_sdf`).
 */
import { describe, expect, it } from 'vitest';
import { texteCpDv360, texteSdfDv360 } from '@/lib/digital/fichiers-dv360';
import { EN_TETES_CSV, fichierPlateforme, formatsDe, type EnteteFichier, type UniteFichier } from '@/lib/zones/fichiers-plateformes';

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

/**
 * `extraireJeuZone` (lot 5, T8, relecture round 1) contre une base simulée (`_doublures-route.ts`) : les mailles
 * EXACTES figées sans calcul (ruling du contrôleur), et les chemins d'échec — aucune unité retenue, règle disparue de
 * `plateformes_geo`, refus d'une RPC préfixé de la plateforme, groupes de CP illisibles. Le chemin complet contre la
 * vraie base : `tests/integration/jeu-zone-extraction.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminClient, etat, reinitialiser, ORG } from '../api/_doublures-route';
import { extraireJeuZone } from '@/lib/zones/extraction-jeu-zone';
import type { Tables } from '@/types/database.types';

const ZONE = '3f2504e0-4f89-11d3-9a0c-0305e82c3304';
const JEU = {
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3302', org_id: ORG, custom_geo_zone_id: ZONE, cible: 'ind', mode_plan: 'pondere', type: 'zone',
} as Tables<'zone_sets'>;

const regle = (plateforme: string, maille: string, limites: Record<string, number> = {}) => ({
  plateforme, maille, libelle: maille, natif: true, disponible: true, limites, doc_url: null, releve_le: '2026-10-14',
  a_verifier: false, note: null, ordre: 1,
});
const COUVERTURE = {
  population: 10_000, surface_km2: 78.5,
  lignes: [
    { code: '69001', nom: 'Lyon 1', commune: null, n_carreaux: 5, pop_en_zone: 6_000, pop_totale: 6_500, part: 92.3 },
    { code: '69002', nom: 'Lyon 2', commune: null, n_carreaux: 5, pop_en_zone: 3_000, pop_totale: 10_000, part: 30 },
    { code: '69003', nom: 'Lyon 3', commune: null, n_carreaux: 1, pop_en_zone: 1_000, pop_totale: 50_000, part: 2 },
  ],
};

function jeuAvec(choix: object[], recette: object, regles: object[]) {
  etat.tables.zone_set_plateformes = { data: choix, error: null };
  etat.tables.custom_geo_zones = { data: { recette }, error: null };
  etat.tables.plateformes_geo = { data: regles, error: null };
  etat.tables.cp_groupe = { data: [], error: null };
  etat.reponses.couverture_zone = { data: COUVERTURE, error: null };
  etat.reponses.creer_extraction_jeu_zone = { data: { ok: true, deja_extraite: false, id: 'x', version: 1 }, error: null };
}
const extraire = () => extraireJeuZone(createAdminClient() as never, JEU, { origine: 'initiale', commentaire: '' }, 'u1');
const argsCreation = () => etat.rpcs.find((r) => r.nom === 'creer_extraction_jeu_zone')!.args as {
  p_cp: { code_postal: string; retenu: boolean }[];
  p_unites: Record<string, unknown>[];
  p_resume: { plateformes: Record<string, unknown>[] };
};

const POINT = { v: 1, type: 'rayon_point', lon: 4.8357, lat: 45.764, rayon_m: 5000 };
const LISTE = { v: 1, type: 'codes_postaux', codes: ['69001', '69002', '69002'] };
const DESSIN = { v: 1, type: 'dessin' };

beforeEach(() => {
  reinitialiser();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('mailles exactes : la géométrie de la recette, sans calcul ni seuil', () => {
  it('rayon_point en cercle au MÊME rayon : UN cercle (centre et rayon de la recette), aucun pavage, zéro perte', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 5000 }], POINT,
      [regle('meta', 'cercle', { rayon_min_m: 1000, rayon_max_m: 80000 })]);
    expect((await extraire()).status).toBe(201);
    expect(etat.rpcs.map((r) => r.nom)).not.toContain('paver_cercles');
    expect(argsCreation().p_unites).toEqual([{
      plateforme: 'meta', maille: 'cercle', lon: 4.8357, lat: 45.764, rayon_m: 5000,
      pop_en_zone: 10_000, pop_totale: 10_000, part: 100, retenu: true,
    }]);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({
      exacte: true, n_unites: 1, population: 10_000, couverte: 10_000, achetee: 10_000, manques: 0, hors_zone: 0, taux_utile: 100,
    });
  });

  it('rayon_point en cercle à un AUTRE rayon : pavage, exacte false, n_candidates (et non n_touchees)', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 2000 }], POINT, [regle('meta', 'cercle', { rayon_min_m: 1000 })]);
    etat.reponses.paver_cercles = {
      data: {
        n_candidates: 12, n_cercles: 1, population: 10_000, couverte: 4_000, manques: 6_000, hors_zone: 500, achetee: 4_500,
        taux_utile: 88.9, cercles: [{ lon: 4.8, lat: 45.7, pop_en_zone: 4_000, pop_totale: 4_500, part: 88.9 }],
      },
      error: null,
    };
    expect((await extraire()).status).toBe(201);
    const resume = argsCreation().p_resume.plateformes[0];
    expect(resume).toMatchObject({ exacte: false, n_unites: 1, n_candidates: 12, manques: 6_000 });
    expect(resume).not.toHaveProperty('n_touchees');
  });

  it('codes_postaux au CP : la liste de la recette (dédoublonnée), seuil ignoré ; plan CP sur la liste', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 95, rayon_m: null }], LISTE, [regle('dv360', 'cp')]);
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_unites).toEqual([
      { plateforme: 'dv360', maille: 'cp', code: '69001', retenu: true },
      { plateforme: 'dv360', maille: 'cp', code: '69002', retenu: true },
    ]);
    expect(argsCreation().p_cp.filter((l) => l.retenu).map((l) => l.code_postal)).toEqual(['69001', '69002']);
    expect(argsCreation().p_resume.plateformes[0]).toMatchObject({ exacte: true, n_unites: 2, manques: 0 });
  });

  it('polygone : la population de la zone dans le résumé (exacte, aucune perte, chiffré)', async () => {
    jeuAvec([{ plateforme: 'ttd', maille: 'polygone', seuil: 0, rayon_m: null }], DESSIN, [regle('ttd', 'polygone')]);
    expect((await extraire()).status).toBe(201);
    expect(argsCreation().p_resume.plateformes[0])
      .toMatchObject({ exacte: true, n_unites: 1, population: 10_000, couverte: 10_000, surface_km2: 78.5 });
    expect(etat.rpcs.find((r) => r.nom === 'couverture_zone')!.args).toMatchObject({ p_decoupage: 'forme', p_org_id: ORG });
  });
});

describe('chemins d’échec', () => {
  it('aucune unité retenue au seuil : 422 nommé, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'tiktok', maille: 'commune', seuil: 95, rayon_m: null }], DESSIN, [regle('tiktok', 'commune')]);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/^tiktok — aucune unité retenue au seuil de 95 %/);
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });

  it('règle disparue de plateformes_geo depuis l’enregistrement : 422, aucun calcul', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, []);
    const r = await extraire();
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe('dv360 n’achète pas à la maille cp. Réglez à nouveau le jeu avant d’extraire.');
    expect(etat.rpcs).toEqual([]);
  });

  it('refus de paver_cercles : même statut, message préfixé de la plateforme, chiffres gardés', async () => {
    jeuAvec([{ plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 1000 }], DESSIN, [regle('meta', 'cercle', { max_unites: 200 })]);
    etat.reponses.paver_cercles = { data: { refus: 'trop_de_cercles', n_cercles: 481, plafond: 200 }, error: null };
    const r = await extraire();
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({
      error: 'meta — Trop de cercles retenus pour cette plateforme : augmentez le rayon ou le seuil.',
      refus: 'trop_de_cercles', n_cercles: 481, plafond: 200, plateforme: 'meta',
    });
  });

  it('groupes de CP illisibles : 500 neutre, rien d’écrit', async () => {
    jeuAvec([{ plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null }], DESSIN, [regle('dv360', 'cp')]);
    etat.tables.cp_groupe = { data: null, error: { message: 'secret' } };
    const r = await extraire();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('secret');
    expect(etat.rpcs.map((x) => x.nom)).not.toContain('creer_extraction_jeu_zone');
  });
});

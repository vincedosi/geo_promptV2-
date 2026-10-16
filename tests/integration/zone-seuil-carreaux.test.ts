/**
 * Seuil sur carreaux Filosofi 200 m (spec § 16.3 : « indicateur > 40 % → l'union des carreaux = un polygone »).
 * Un carreau est retenu par son CENTROÏDE dans le périmètre (L3-2), calculé sur geom_3857 : geom_centroid est NULL
 * partout en local (spec § 16.6). Mesures du 2026-10-14 : Bouches-du-Rhône, ménages pauvres ≥ 40 % → 505 carreaux,
 * 1,7 s ; un seuil sélectif lit 69 000 buffers sur la Gironde et 433 000 sur la région 75 (d'où la borne au
 * département).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { creerClientTest } from './_client';
import { INDICATEURS_SEUIL_CARREAUX } from '@/lib/zones/recette';

const admin = creerClientTest();
const appeler = (args: Record<string, unknown>) => admin.rpc('zone_seuil_carreaux', {
  p_indicateur: 'part_men_pauv', p_operateur: '>=', p_seuil: 40, p_perimetre_type: 'departement',
  p_perimetre_code: '13', p_org_id: null, p_max_carreaux: 20000, ...args,
});

describe('zone_seuil_carreaux', () => {
  it('le case SQL connaît EXACTEMENT les 13 indicateurs de lib/zones/recette.ts', () => {
    const f = readdirSync('sql').find((n) => /_zone_seuil_carreaux\.sql$/.test(n))!;
    const sql = readFileSync(`sql/${f}`, 'utf8');
    const ids = [...sql.matchAll(/when '([a-z0-9_]+)'\s+then v_num/g)].map((m) => m[1]).sort();
    expect(ids).toEqual(INDICATEURS_SEUIL_CARREAUX.map((i) => i.id).sort());
  });
  it('ménages pauvres ≥ 40 % dans les Bouches-du-Rhône : quelques centaines de carreaux, une forme, une population', async () => {
    const { data, error } = await appeler({});
    expect(error).toBeNull();
    const r = data as { vide: boolean; compte: number; population: number; geometry: { type: string }; surface_km2: number };
    expect(r.vide).toBe(false);
    expect(r.compte).toBeGreaterThan(100);
    expect(r.compte).toBeLessThan(5000);
    expect(r.population).toBeGreaterThan(0);
    expect(r.geometry.type).toBe('MultiPolygon');
    // un carreau 200 m = 0,04 km² ; l'union ne peut pas dépasser compte × 0,04
    expect(r.surface_km2).toBeLessThanOrEqual(r.compte * 0.04 + 0.01);
  });
  it('densité ≥ 20 000 hab./km² à Paris (commune « paris » tapée dans ① = ses 20 arrondissements) : non vide', async () => {
    const { data } = await appeler({ p_indicateur: 'densite_ind', p_seuil: 20000, p_perimetre_type: 'commune', p_perimetre_code: 'paris' });
    expect((data as { compte: number }).compte).toBeGreaterThan(0);
  });
  it('région : refusée (borne au département, A-4) — en lecture de garde seulement, aucun carreau lu', async () => {
    expect((await appeler({ p_perimetre_type: 'region', p_perimetre_code: '75' })).data).toEqual({ refus: 'perimetre_non_admis' });
  });
  it('plus de carreaux que le plafond : refus, jamais une zone partielle', async () => {
    const { data } = await appeler({ p_seuil: 1, p_max_carreaux: 50 });
    expect(data).toEqual({ refus: 'trop_de_carreaux', plafond: 50 });
  });
  it.each([
    ['France', { p_perimetre_type: 'france', p_perimetre_code: 'FR' }, { refus: 'perimetre_national_refuse' }],
    ['indicateur hors liste', { p_indicateur: 'men' }, { refus: 'indicateur_inconnu' }],
  ])('%s : refus', async (_n, args, attendu) => {
    expect((await appeler(args)).data).toEqual(attendu);
  });
  it('opérateur inconnu : 22023', async () => {
    expect((await appeler({ p_operateur: '>' })).error?.code).toBe('22023');
  });
});

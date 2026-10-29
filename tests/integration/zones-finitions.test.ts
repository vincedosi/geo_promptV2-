/**
 * Finitions de ③ Zones (plan 2026-10-29-carte-en-parcours-zones, Groupe A).
 *
 * T1 — seuil sur carreaux : un carreau de moins de N ménages (valeurs IMPUTÉES par l'INSEE sous 11 ménages, secret
 * statistique) peut être écarté ; une zone d'avant le lot (recette sans `min_menages`) se recalcule À L'IDENTIQUE.
 * Chiffres mesurés le 29/10 sur la base locale (Gironde, ménages pauvres ≥ 40 %) : 732 carreaux et 29,28 km² sans
 * minimum, 191 carreaux à 11 ménages (244 des 732 ont moins d'UN ménage). Codes de département normalisés à l'entrée.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';
import { executerRecette } from '@/lib/zones/executer-recette';
import { lireRecette } from '@/lib/zones/recette-schema';

const admin = creerClientTest();
type ClientAdmin = Parameters<typeof executerRecette>[0];

interface Zone { vide: boolean; compte: number; surface_km2: number; population: number }

describe('T1 — seuil sur carreaux : minimum de ménages', () => {
  const GIRONDE = {
    p_indicateur: 'part_men_pauv', p_operateur: '>=', p_seuil: 40, p_perimetre_type: 'departement',
    p_perimetre_code: '33', p_org_id: null,
  };

  it('l’enveloppe historique (zones d’avant le lot) rend la même forme qu’avant : 732 carreaux, 29,28 km²', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux', GIRONDE);
    expect(error).toBeNull();
    const z = data as Zone;
    expect([z.compte, z.surface_km2]).toEqual([732, 29.28]);
  });

  it('la jumelle à 0 ménage est la même zone que l’enveloppe', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages: 0 });
    expect(error).toBeNull();
    const z = data as Zone;
    expect([z.compte, z.surface_km2]).toEqual([732, 29.28]);
  });

  it('à 11 ménages : 191 carreaux, et aucun carreau de moins de 11 ménages dans la forme', async () => {
    const { data, error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages: 11 });
    expect(error).toBeNull();
    expect((data as Zone).compte).toBe(191);
    // Trois carreaux retenus à 0 et écartés à 11 (0,4 ; 10,6 ; 10,2 ménages) et un carreau de 11 ménages tout juste,
    // retenu (la borne est INCLUSE). Par le centroïde, comme la règle de la RPC.
    const dans = psql(`
      with z as (select st_geomfromgeojson(public.zone_seuil_carreaux_min('part_men_pauv', '>=', 40, 'departement', '33',
                   null, 11)->>'geometry') g)
      select string_agg(cf.id || ':' || st_intersects(st_transform(st_centroid(cf.geom_3857), 4326), z.g), ',' order by cf.id)
        from public.carreaux_filosofi cf, z where cf.id in (46507, 454903, 1208980, 258312);`);
    expect(dans).toBe('46507:false,258312:true,454903:false,1208980:false');
  });

  it('minimum hors bornes (négatif, au-delà de 1 000, NULL) : 22023', async () => {
    for (const p_min_menages of [-1, 1001, null]) {
      const { error } = await admin.rpc('zone_seuil_carreaux_min', { ...GIRONDE, p_min_menages });
      expect(error?.code, String(p_min_menages)).toBe('22023');
    }
  });

  it('l’exécuteur passe le minimum de la recette enregistrée, et 0 quand la recette n’en porte pas', async () => {
    const lue = lireRecette({ v: 1, type: 'seuil_carreaux', indicateur: 'part_men_pauv', operateur: '>=', seuil: 40, perimetre: { type: 'departement', code: '33' } });
    if (!lue.ok) throw new Error(lue.message);
    const sans = await executerRecette(admin as unknown as ClientAdmin, lue.recette, { orgId: '00000000-0000-0000-0000-000000000000', sources: [] });
    const avec = await executerRecette(admin as unknown as ClientAdmin, { ...lue.recette, min_menages: 11 } as typeof lue.recette, { orgId: '00000000-0000-0000-0000-000000000000', sources: [] });
    expect(sans.ok && sans.compte).toBe(732);
    expect(avec.ok && avec.compte).toBe(191);
  });
});

describe('T1 — codes de territoire normalisés à l’entrée (V-8)', () => {
  it('seuil sur territoires en « 2a » tapé avec espaces : le même résultat qu’en « 2A »', async () => {
    const recette = (code: string) => {
      const r = lireRecette({ v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code } });
      if (!r.ok) throw new Error(r.message);
      return r.recette;
    };
    const ctx = { orgId: '00000000-0000-0000-0000-000000000000', sources: [], indicateurs: new Set(['taux_pauvrete']) };
    const propre = await executerRecette(admin as unknown as ClientAdmin, recette('2A'), ctx);
    const tape = await executerRecette(admin as unknown as ClientAdmin, recette(' 2a '), ctx);
    expect(propre.ok).toBe(true);
    expect(tape).toEqual(propre);
  });
});

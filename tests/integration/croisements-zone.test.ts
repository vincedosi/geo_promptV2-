/**
 * `croisements_zone` (sql/273, lot 4, T13) — les émetteurs radio dont le cercle touche une zone et les comptages
 * routiers qui la traversent. Lecture seule, `jsonb`, listes bornées.
 *
 * Ce que ce fichier prouve :
 *   - Bouches-du-Rhône : au moins un émetteur, stations dédoublonnées et triées, compteurs = totaux ;
 *   - le pré-filtre `&&` (emprise élargie du plus grand rayon) ne perd AUCUN émetteur : même compte que sans index ;
 *   - `p_limite = 1` : une ligne par liste, `tronque`, totaux inchangés ;
 *   - `zone_maj` = `updated_at` de la zone (l'écran y périme la liste après un recalcul en ③) ;
 *   - zone d'un autre espace : `zone_introuvable` ; zone > 100 000 km² : `zone_trop_vaste` ; limite hors bornes : 22023 ;
 *   - le plan reste PERSONNALISÉ (`plan_cache_mode`) : le plan générique d'une 6e lecture passait de 1,3 s à 46 s.
 *
 * Zones créées par `creer_zone_recette` dans deux espaces de test, supprimés (cascade) en fin de fichier.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { psql } from './_psql';

const admin = creerClientTest();
const LONG = 120_000;

interface Croisements {
  refus?: string;
  zone_maj: string;
  radio: {
    n_emetteurs: number; n_sans_rayon: number; tronque: boolean;
    emetteurs: { site: string; lieu: string | null; stations: string[] }[];
  };
  trafic: {
    n_comptages: number; tmja_max: number | null; tmja_median: number | null; tronque: boolean;
    comptages: { route: string; tmja: number; annee_mesure: number }[];
  };
}

let org = '';
let autreOrg = '';
let bdr = '';
let vaste = '';

async function nouvelleOrg(nom: string) {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI lot4 T13] ${nom}`, slug: `essai-lot4-t13-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(error?.message);
  return data.id as string;
}

async function croisements(zone: string, args: Record<string, unknown> = {}, o = org) {
  return admin.rpc('croisements_zone', { p_zone_id: zone, p_org_id: o, ...args });
}

beforeAll(async () => {
  org = await nouvelleOrg('a');
  autreOrg = await nouvelleOrg('b');
  bdr = psql(`select public.creer_zone_recette('Département 13', '${org}', null, '{"v":1,"type":"dessin"}', ST_AsGeoJSON(r.g))->>'id'
                from public.resoudre_perimetre('departement', '13', null, 100000, array['departement']) r;`);
  // Deux régions réunies (≈ 155 000 km²) : au-delà du plafond de 100 000 km².
  vaste = psql(`insert into public.custom_geo_zones (name, org_id, source_type, geometry)
                select 'Deux régions', '${org}', 'composite', ST_Multi(ST_CollectionExtract(ST_Union(geom), 3))
                  from public.ref_regions where code_region in ('75', '84') returning id;`);
}, LONG);

afterAll(async () => {
  for (const o of [org, autreOrg]) {
    if (!o) continue;
    const { error } = await admin.from('organizations').delete().eq('id', o);
    if (error) throw new Error(`nettoyage : ${error.message}`);
  }
});

describe('croisements_zone — Bouches-du-Rhône', () => {
  it('au moins un émetteur, stations dédoublonnées et triées ; comptages ≥ 0, TMJA cohérents', async () => {
    const { data, error } = await croisements(bdr);
    expect(error).toBeNull();
    const r = data as Croisements;
    expect(r.radio.n_emetteurs).toBeGreaterThan(0);
    expect(r.radio.emetteurs).toHaveLength(Math.min(r.radio.n_emetteurs, 200));
    expect(r.radio.tronque).toBe(r.radio.n_emetteurs > 200);
    expect(r.radio.n_sans_rayon).toBeGreaterThanOrEqual(0);
    // Ronde 1, I1 : ni fréquence (87,5 partout), ni puissance (vide), ni type de comptage (une seule valeur).
    expect(Object.keys(r.radio.emetteurs[0]).sort()).toEqual(['lieu', 'site', 'stations']);
    for (const e of r.radio.emetteurs) {
      expect(e.site).toBeTruthy();
      // Triées dans la collation de la base (en_US : « Beur FM » avant « BFM Radio »).
      expect(e.stations).toEqual([...new Set(e.stations)].sort(new Intl.Collator('en').compare));
    }
    expect(Date.parse(r.zone_maj)).toBe(Date.parse(psql(`select updated_at from public.custom_geo_zones where id = '${bdr}';`)));
    expect(r.trafic.n_comptages).toBeGreaterThanOrEqual(0);
    expect(r.trafic.comptages).toHaveLength(Math.min(r.trafic.n_comptages, 200));
    if (r.trafic.n_comptages > 0) {
      expect(Object.keys(r.trafic.comptages[0]).sort()).toEqual(['annee_mesure', 'route', 'tmja']);
      expect(r.trafic.tmja_max).toBe(r.trafic.comptages[0].tmja);
      expect(r.trafic.tmja_median!).toBeLessThanOrEqual(r.trafic.tmja_max!);
    }
  });

  it('le pré-filtre par emprise élargie ne perd aucun émetteur : même compte que le prédicat seul', async () => {
    const { data } = await croisements(bdr);
    const brut = Number(psql(`select count(*) from public.emetteurs_radio e, public.custom_geo_zones z
                               where z.id = '${bdr}' and e.rayon_couverture_m is not null
                                 and ST_DWithin(e.geom::geography, z.geometry::geography, e.rayon_couverture_m);`));
    expect((data as Croisements).radio.n_emetteurs).toBe(brut);
    const comptages = Number(psql(`select count(*) from public.comptages_routiers c, public.custom_geo_zones z
                                    where z.id = '${bdr}' and ST_Intersects(c.geom, z.geometry);`));
    expect((data as Croisements).trafic.n_comptages).toBe(comptages);
  });

  it('limite 1 : une ligne par liste, tronque, totaux inchangés', async () => {
    const tout = (await croisements(bdr)).data as Croisements;
    const r = (await croisements(bdr, { p_limite: 1 })).data as Croisements;
    expect(r.radio.emetteurs).toHaveLength(1);
    expect(r.radio.tronque).toBe(true);
    expect(r.radio.n_emetteurs).toBe(tout.radio.n_emetteurs);
    expect(r.radio.emetteurs[0]).toEqual(tout.radio.emetteurs[0]);
    expect(r.trafic.comptages).toHaveLength(Math.min(1, tout.trafic.n_comptages));
    expect(r.trafic.tronque).toBe(tout.trafic.n_comptages > 1);
    expect(r.trafic.tmja_median).toBe(tout.trafic.tmja_median);
  });
});

describe('croisements_zone — refus', () => {
  it('zone d’un autre espace : zone_introuvable', async () => {
    const { data, error } = await croisements(bdr, {}, autreOrg);
    expect(error).toBeNull();
    expect(data).toEqual({ refus: 'zone_introuvable' });
  });
  it('zone de plus de 100 000 km² : zone_trop_vaste, avant toute lecture d’émetteur', async () => {
    const { data, error } = await croisements(vaste);
    expect(error).toBeNull();
    expect(data).toMatchObject({ refus: 'zone_trop_vaste', plafond_km2: 100000 });
  });
  it('plan personnalisé à chaque appel (le plan générique coûtait 35 fois plus)', () => {
    expect(psql(`select proconfig::text from pg_proc where proname = 'croisements_zone';`)).toContain('plan_cache_mode=force_custom_plan');
  });
  it('limite hors bornes : 22023', async () => {
    for (const p_limite of [0, 1001]) {
      const { error } = await croisements(bdr, { p_limite });
      expect(error?.code, String(p_limite)).toBe('22023');
    }
  });
});

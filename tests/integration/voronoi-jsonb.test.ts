/**
 * `get_voronoi_by_category_jsonb` (sql/246) — le Voronoï d'une catégorie sans
 * la coupe à 1 000 de PostgREST.
 *
 * `get_voronoi_by_category` (`RETURNS SETOF json`) était coupée à
 * `db-max-rows` : mesuré le 2026-10-10, 4 653 cellules de lycées en base,
 * 1 000 rendues. La jumelle porte le corps de sql/164, rend du `jsonb` et DIT
 * quand sa borne est atteinte ; l'originale en est une enveloppe mince.
 *
 * ⚠ Lit la base locale. On joue la catégorie `cirfa` (95 cellules, 0,7 s) et
 * pas `lycee` (14 s, ≈ 46 000 blocs lus) : la preuve au-delà de 1 000 lignes
 * est dans le rapport de la tâche et dans le test unitaire de l'outil.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Cellule { type: string; geometry: { type: string }; properties: { id: string; nom: string | null } }
interface Reponse { features: Cellule[]; tronque: boolean }

describe('get_voronoi_by_category_jsonb', () => {
  it('cirfa : une cellule par point, ids uniques, la même liste que l enveloppe SETOF', async () => {
    const { data, error } = await sb.rpc('get_voronoi_by_category_jsonb', { cat_name: 'cirfa', metropolitaine: true });
    expect(error).toBeNull();
    const r = data as Reponse;
    expect(r.tronque).toBe(false);
    expect(r.features.length).toBeGreaterThan(50);
    const ids = r.features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of r.features) {
      expect(f.type).toBe('Feature');
      expect(['Polygon', 'MultiPolygon', 'GeometryCollection']).toContain(f.geometry.type);
    }

    // L'enveloppe (sous 1 000 lignes ici, donc non coupée) rend la même chose.
    const env = await sb.rpc('get_voronoi_by_category', { cat_name: 'cirfa', metropolitaine: true });
    expect(env.error).toBeNull();
    const idsEnv = (env.data as Cellule[]).map((f) => f.properties.id);
    expect([...idsEnv].sort()).toEqual([...ids].sort());
  });

  it('borne atteinte : exactement la borne et tronque = vrai ; pile : faux', async () => {
    const tout = (await sb.rpc('get_voronoi_by_category_jsonb', { cat_name: 'cirfa', metropolitaine: true })).data as Reponse;
    const n = tout.features.length;
    const moins = (await sb.rpc('get_voronoi_by_category_jsonb', { cat_name: 'cirfa', metropolitaine: true, p_limite: n - 1 })).data as Reponse;
    expect(moins.features).toHaveLength(n - 1);
    expect(moins.tronque).toBe(true);
    const pile = (await sb.rpc('get_voronoi_by_category_jsonb', { cat_name: 'cirfa', metropolitaine: true, p_limite: n })).data as Reponse;
    expect(pile.features).toHaveLength(n);
    expect(pile.tronque).toBe(false);
  });

  it('catégorie inconnue : aucune cellule, sans erreur', async () => {
    const { data, error } = await sb.rpc('get_voronoi_by_category_jsonb', { cat_name: 'categorie_qui_n_existe_pas' });
    expect(error).toBeNull();
    expect(data).toEqual({ features: [], tronque: false });
  });
});

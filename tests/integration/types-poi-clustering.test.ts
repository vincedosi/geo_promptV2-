/**
 * `types_poi_clustering` (sql/248) — les types de POI de l'assistant de
 * clustering, comptés en base et non sur les 1 000 premières lignes.
 *
 * `GET /api/poi-clusters/poi-types` lisait `poi_france` sans pagination :
 * PostgREST coupait à 1 000 lignes sur 390 029 (mesuré le 2026-10-11), et
 * l'assistant ne proposait qu'« arret_transport 1 000 POIs ».
 *
 * ⚠ Lit la base locale. Compare la RPC aux comptes faits par PostgREST avec
 * `count: 'exact'` (en-tête, pas de lignes rendues, donc pas de plafond).
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';
import { lireTout } from '@/lib/supabase/lire-tout';

const sb = creerClientTest();

interface Type { type: string; total: number; clustered: number }

describe('types_poi_clustering', () => {
  it('une entrée par catégorie, totaux exacts au-delà de 1 000, triés par total décroissant', async () => {
    const { data, error } = await sb.rpc('types_poi_clustering');
    expect(error).toBeNull();
    const types = data as Type[];
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);

    const noms = types.map((t) => t.type);
    expect(new Set(noms).size).toBe(noms.length);
    for (let i = 1; i < types.length; i++) {
      expect(types[i - 1].total).toBeGreaterThanOrEqual(types[i].total);
    }

    // La somme des totaux = le nombre de lignes de poi_france (categorie NOT NULL).
    const tout = await sb.from('poi_france').select('id', { count: 'exact', head: true });
    expect(tout.error).toBeNull();
    expect(types.reduce((s, t) => s + t.total, 0)).toBe(tout.count);
    // Le défaut corrigé : au moins une catégorie dépasse le plafond de 1 000.
    expect(Math.max(...types.map((t) => t.total))).toBeGreaterThan(1000);

    // Chaque total, recompté par catégorie.
    for (const t of types) {
      const n = await sb.from('poi_france').select('id', { count: 'exact', head: true }).eq('categorie', t.type);
      expect(n.error).toBeNull();
      expect(t.total).toBe(n.count);
      expect(t.clustered).toBeGreaterThanOrEqual(0);
      expect(t.clustered).toBeLessThanOrEqual(t.total);
    }
  });

  it('clustered = POI distincts présents dans poi_clusters, tous modèles confondus', async () => {
    const { data } = await sb.rpc('types_poi_clustering');
    const somme = (data as Type[]).reduce((s, t) => s + t.clustered, 0);
    // Lecture COMPLÈTE par lireTout (pages de 1 000, triées sur la clé) : au-delà
    // de 1 000 lignes le test vérifie toujours, il ne se tait pas (revue 1, M-4).
    const { lignes } = await lireTout<{ poi_id: string }>(
      (de, a) => sb.from('poi_clusters').select('poi_id').order('id', { ascending: true }).range(de, a),
      500_000,
    );
    expect(somme).toBe(new Set(lignes.map((r) => r.poi_id)).size);
  });
});

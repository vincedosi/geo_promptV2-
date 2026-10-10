/**
 * `lire_arrets_transport_bbox` (sql/241) — les arrêts d'une vue en UN passage.
 *
 * La lecture paginée de `/api/map/transport` refaisait, à chaque page de
 * 1 000, tout le parcours de l'index de catégorie (285 015 arrêts) : mesuré le
 * 2026-10-10 sur la vue de Paris (22 108 arrêts), ≈ 177 000 buffers pour six
 * requêtes, contre ≈ 6 000 pour ce passage unique par l'index GIST.
 *
 * ⚠ Lit la base locale : on vérifie des relations, pas des valeurs figées.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Reponse {
  arrets: { id: string; nom: string | null; lat: number; lng: number; sous_categorie: string | null }[];
  tronque: boolean;
}

const MARSEILLE = { p_west: 5.4623, p_south: 43.2782, p_east: 5.9494, p_north: 43.5003 };
const PARIS = { p_west: 2.0, p_south: 48.6, p_east: 2.6, p_north: 49.0 };

describe('lire_arrets_transport_bbox', () => {
  it('vue sous la borne : tous les arrêts, dans la bbox, sans doublon, tronque = faux', async () => {
    const { data, error } = await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_limite: 5000 });
    expect(error).toBeNull();
    const r = data as Reponse;
    expect(r.tronque).toBe(false);
    expect(r.arrets.length).toBeGreaterThan(1000);
    expect(new Set(r.arrets.map((a) => a.id)).size).toBe(r.arrets.length);
    for (const a of r.arrets) {
      expect(a.lat).toBeGreaterThanOrEqual(MARSEILLE.p_south);
      expect(a.lat).toBeLessThanOrEqual(MARSEILLE.p_north);
      expect(a.lng).toBeGreaterThanOrEqual(MARSEILLE.p_west);
      expect(a.lng).toBeLessThanOrEqual(MARSEILLE.p_east);
    }
  });

  it('vue au-delà de la borne : exactement la borne, et tronque = vrai', async () => {
    const { data, error } = await sb.rpc('lire_arrets_transport_bbox', { ...PARIS, p_limite: 5000 });
    expect(error).toBeNull();
    const r = data as Reponse;
    expect(r.arrets).toHaveLength(5000);
    expect(r.tronque).toBe(true);
  });

  it('borne atteinte pile : tronque = faux quand il ne reste rien', async () => {
    const tout = (await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_limite: 5000 })).data as Reponse;
    const n = tout.arrets.length;
    const pile = (await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_limite: n })).data as Reponse;
    expect(pile.arrets).toHaveLength(n);
    expect(pile.tronque).toBe(false);
    const moins = (await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_limite: n - 1 })).data as Reponse;
    expect(moins.arrets).toHaveLength(n - 1);
    expect(moins.tronque).toBe(true);
  });

  it('filtre de types et périmètre de sources', async () => {
    const bus = (await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_types: ['bus'], p_limite: 5000 })).data as Reponse;
    expect(bus.arrets.length).toBeGreaterThan(0);
    expect(bus.arrets.every((a) => a.sous_categorie === 'bus')).toBe(true);
    // Périmètre vide : seuls les référentiels (sans source) passent — les arrêts en sont.
    const socle = (await sb.rpc('lire_arrets_transport_bbox', { ...MARSEILLE, p_sources: [], p_limite: 5000 })).data as Reponse;
    expect(socle.arrets.length).toBeGreaterThan(0);
  });
});

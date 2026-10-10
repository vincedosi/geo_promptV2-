/**
 * `get_radio_emetteurs_geojson` — un seul candidat, et des émetteurs qui
 * portent leur radio.
 *
 * ── LES DEUX DÉFAUTS QUE CE FICHIER VERROUILLE (sql/240) ──────────────────
 *
 * **1. Deux surcharges, un appel ambigu.** sql/078 créait la fonction à 4
 * arguments, sql/080 la « remplaçait » par une version à 6 — mais un
 * `CREATE OR REPLACE` d'une AUTRE signature crée une seconde fonction. Dès que
 * la route ne passait ni `radio_ids` ni `exclude_categories` (le cas par
 * défaut de la carte), PostgREST répondait « Could not choose the best
 * candidate function » : 500, et aucun émetteur, dans React comme Angular.
 *
 * **2. Des émetteurs sans radio.** Les propriétés ne portaient ni `radio_nom`,
 * ni `radio_id`, ni `portee`, que les deux cartes lisent : popups « Radio non
 * associée », points gris de portée inconnue, radio choisie jamais mise en
 * évidence. La donnée existait — 569 698 liaisons dans
 * `emetteur_radio_stations` — la RPC ne la joignait pas.
 *
 * ⚠ Ces tests LISENT la base locale. Aucune valeur absolue n'est figée : on
 * vérifie des relations.
 */
import { describe, it, expect } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

interface Emetteur {
  properties: Record<string, unknown>;
}
interface Collection {
  type: string;
  features: Emetteur[];
}

describe('get_radio_emetteurs_geojson', () => {
  it('répond avec les seuls paramètres par défaut de la route (plus de surcharge ambiguë)', async () => {
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_limit: 50 });
    expect(error).toBeNull();
    const fc = data as Collection;
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(50);
  });

  it('chaque émetteur lié porte sa radio : nom, identifiant, portée, catégorie', async () => {
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_limit: 200 });
    expect(error).toBeNull();
    const lies = (data as Collection).features.filter((f) => Number(f.properties.nb_radios) > 0);
    expect(lies.length).toBeGreaterThan(0);
    for (const f of lies) {
      expect(typeof f.properties.radio_nom).toBe('string');
      expect(typeof f.properties.radio_id).toBe('string');
      expect('portee' in f.properties).toBe(true);
      expect('categorie_arcom' in f.properties).toBe(true);
    }
    // Au moins une portée connue : sinon tous les points resteraient gris.
    expect(lies.some((f) => typeof f.properties.portee === 'string')).toBe(true);
  });

  it('radio choisie : chaque émetteur rendu porte CETTE radio (la mise en évidence mord)', async () => {
    const options = await sb.rpc('get_radio_filter_options');
    expect(options.error).toBeNull();
    const radios = (options.data as { radios_with_emetteurs: { id: string; nom: string }[] }).radios_with_emetteurs;
    const choisie = radios[0];
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_radio_id: choisie.id, p_limit: 20000 });
    expect(error).toBeNull();
    const fc = data as Collection;
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) {
      expect(f.properties.radio_id).toBe(choisie.id);
      expect(f.properties.radio_nom).toBe(choisie.nom);
    }
  });

  it('exclusion de catégories : la radio rendue n est jamais d une catégorie exclue', async () => {
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', {
      p_limit: 500,
      p_exclude_categories: ['P'],
    });
    expect(error).toBeNull();
    const fc = data as Collection;
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) expect(f.properties.categorie_arcom).not.toBe('P');
  });
});

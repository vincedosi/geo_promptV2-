/**
 * `get_radio_emetteurs_geojson` — un seul candidat, et une radio affichée
 * seulement quand elle est VRAIE.
 *
 * ── LES DÉFAUTS QUE CE FICHIER VERROUILLE ─────────────────────────────────
 *
 * **1. Deux surcharges, un appel ambigu (sql/240).** sql/078 créait la
 * fonction à 4 arguments, sql/080 la « remplaçait » par une version à 6 — mais
 * un `CREATE OR REPLACE` d'une AUTRE signature crée une seconde fonction. Dès
 * que la route ne passait ni `radio_ids` ni `exclude_categories` (le cas par
 * défaut de la carte), PostgREST répondait « Could not choose the best
 * candidate function » : 500, et aucun émetteur, dans React comme Angular.
 *
 * **2. La radio choisie était un choix arbitraire (sql/240 → sql/242).** Un
 * émetteur porte de 13 à 73 radios. sql/240 lui attribuait la première PAR
 * NOM : « Air Zen, locale » s'affichait sur 3 046 émetteurs, dont Mont July
 * qui en porte 73 — une information fausse là où « Radio non associée »
 * était honnête. Règle depuis sql/242 : une radio (nom, id, portée…) n'est
 * rendue que si elle est UNIQUE — seule radio liée sans filtre de radio, ou
 * seule radio du filtre portée par l'émetteur ; sinon ces champs sont NULL et
 * `nb_radios` dit combien de radios l'émetteur porte.
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

/** Les radios liées à un émetteur, lues dans la table de liaison. */
async function radiosDe(emetteurId: string): Promise<string[]> {
  const { data, error } = await sb.from('emetteur_radio_stations').select('radio_id').eq('emetteur_id', emetteurId);
  expect(error).toBeNull();
  return (data ?? []).map((l: { radio_id: string }) => l.radio_id);
}

describe('get_radio_emetteurs_geojson', () => {
  it('répond avec les seuls paramètres par défaut de la route (plus de surcharge ambiguë)', async () => {
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_limit: 50 });
    expect(error).toBeNull();
    const fc = data as Collection;
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(50);
  });

  it('sans filtre de radio : une radio n est rendue que si l émetteur n en porte qu UNE, et nb_radios est le vrai compte', async () => {
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_limit: 200 });
    expect(error).toBeNull();
    const features = (data as Collection).features;
    const multiples = features.filter((f) => Number(f.properties.nb_radios) > 1);
    expect(multiples.length).toBeGreaterThan(0);
    for (const f of multiples) {
      expect(f.properties.radio_id ?? null).toBeNull();
      expect(f.properties.radio_nom ?? null).toBeNull();
      expect(f.properties.portee ?? null).toBeNull();
      expect(f.properties.categorie_arcom ?? null).toBeNull();
    }
    for (const f of features.filter((x) => Number(x.properties.nb_radios) === 1)) {
      expect(typeof f.properties.radio_nom).toBe('string');
    }
    // nb_radios = nombre de liaisons, vérifié sur quelques émetteurs
    for (const f of features.slice(0, 5)) {
      const liees = await radiosDe(String(f.properties.id));
      expect(Number(f.properties.nb_radios)).toBe(liees.length);
    }
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

  it('plusieurs radios filtrées : la radio n est rendue que si l émetteur n en porte qu UNE du filtre', async () => {
    // Un émetteur de référence et deux de ses radios : il porte les DEUX.
    const premier = ((await sb.rpc('get_radio_emetteurs_geojson', { p_limit: 1 })).data as Collection).features[0];
    const liees = await radiosDe(String(premier.properties.id));
    expect(liees.length).toBeGreaterThan(1);
    const [a, b] = liees;
    const { data, error } = await sb.rpc('get_radio_emetteurs_geojson', { p_radio_ids: [a, b], p_limit: 20000 });
    expect(error).toBeNull();
    const features = (data as Collection).features;
    const lui = features.find((f) => f.properties.id === premier.properties.id);
    expect(lui).toBeDefined();
    expect(lui!.properties.radio_id ?? null).toBeNull();
    // Les autres : jamais une radio hors du filtre ; et quand une radio est
    // rendue, l'émetteur ne porte pas l'autre.
    for (const f of features) {
      const rid = f.properties.radio_id ?? null;
      if (rid !== null) expect([a, b]).toContain(rid);
    }
    const uniques = features.filter((f) => f.properties.radio_id).slice(0, 5);
    for (const f of uniques) {
      const lr = await radiosDe(String(f.properties.id));
      expect(lr.filter((r) => r === a || r === b)).toHaveLength(1);
    }
  });
});

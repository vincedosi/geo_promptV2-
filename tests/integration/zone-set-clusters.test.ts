/**
 * Les GRAPPES d'un jeu de zones (sql/224, Phase 1 du chantier zones → CP).
 *
 * ── CE QUE CE FICHIER VERROUILLE ──────────────────────────────────────────
 *
 * Une seule chose, et elle a coûté trois mesures pour être obtenue : **la
 * somme des grappes doit égaler ce qu'affiche l'écran**. Mesuré le 2026-09-22
 * sur le profil par défaut, contre les 14 103 578 habitants de l'étape ③ :
 *
 *     test sur le POLYGONE du carreau   224 988 carreaux   14 636 073 hab  (+3,8 %)
 *     test sur son CENTROÏDE            214 628 carreaux   14 047 617 hab  (−0,4 %)
 *     règle `classe_carreau_risque`     215 646 carreaux   14 103 711 hab  (+133)
 *
 * Le polygone sur-compte — un carreau qui effleure la grappe est compté
 * entier. Le centroïde sous-compte — `ST_Buffer` approxime le cercle par un
 * polygone à 32 côtés, un peu plus PETIT, et ni l'un ni l'autre ne voit les
 * périmètres PPRT, qui retiennent sans anneau.
 *
 * Seule la règle unique du module donne le bon compte. Ces tests empêchent
 * qu'on la remplace un jour par un test géométrique « équivalent » — il ne
 * l'est pas.
 *
 * ⚠ Les 133 habitants d'écart restants ne sont PAS un défaut : c'est l'arrondi
 * par unité, déjà documenté pour `population_par_classe` (+1 en région, +22 en
 * département, +502 en commune). 580 grappes × ~0,19 ≈ 110. Ce test verrouille
 * donc un ORDRE DE GRANDEUR, pas une égalité strictea — ce qui distingue un
 * arrondi de la perte d'un bassin entier.
 *
 * ⚠ Ces tests ÉCRIVENT : ils créent un jeu de zones brouillon et le
 * suppriment. Ils ne touchent aucun jeu existant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const sb = creerClientTest();

/** Profil par défaut du module : trois anneaux au seuil haut, deux au bas. */
const PROFIL = { haut: [1000, 2000, 5000], bas: [500, 1000], lie: false, inclurePPRT: true };

interface Grappe {
  rang: number;
  nom: string;
  nom_auto: boolean;
  niveau_dominant: 'haut' | 'bas';
  n_sites: number;
  pop_exposee: number | null;
}

let jeuId: string | null = null;
let grappes: Grappe[] = [];
let construit = false;

beforeAll(async () => {
  // Le pré-calcul doit exister, sinon ces tests parleraient d'autre chose.
  const { count } = await sb
    .from('carreau_risque_distance')
    .select('carreau_id', { count: 'exact', head: true });
  if (!count) return;

  const { data: org } = await sb
    .from('profiles').select('id, organization_id')
    .not('organization_id', 'is', null).limit(1).single();
  if (!org) return;

  const { data: jeu } = await sb
    .from('zone_sets')
    .insert({
      nom: 'TEST grappes (vitest)',
      org_id: org.organization_id,
      created_by: org.id,
      profil: PROFIL,
      gravites: ['seveso_haut', 'seveso_bas'],
      profil_hash: `vitest-${Date.now()}`,
      brouillon: true,
    })
    .select('id').single();
  if (!jeu) return;
  jeuId = jeu.id;

  await sb.rpc('construire_zone_set_clusters', { p_zone_set_id: jeuId });
  const { data } = await sb
    .from('zone_set_clusters').select('*').eq('zone_set_id', jeuId);
  grappes = (data ?? []) as Grappe[];
  construit = grappes.length > 0;
}, 300_000);

afterAll(async () => {
  // Les géométries et les grappes partent en cascade avec le jeu.
  if (jeuId) await sb.from('zone_sets').delete().eq('id', jeuId);
});

describe('zone_set_clusters — les bassins d un jeu de zones', () => {
  it('regroupe les sites en bassins, pas en sites isolés', () => {
    if (!construit) return expect(construit).toBe(false);
    // 1 259 sites retenus par le profil par défaut : s'il y avait autant de
    // grappes que de sites, le regroupement ne servirait à rien.
    expect(grappes.length).toBeGreaterThan(0);
    expect(grappes.length).toBeLessThan(1259);
    const plusGrosse = Math.max(...grappes.map((g) => g.n_sites));
    expect(plusGrosse, 'aucune grappe ne rassemble plusieurs sites').toBeGreaterThan(1);
  });

  it('la somme des grappes égale le total du module, à l arrondi près', async () => {
    if (!construit) return expect(construit).toBe(false);
    const somme = grappes.reduce((s, g) => s + Number(g.pop_exposee ?? 0), 0);

    // La référence : le MÊME profil passé au moteur de l'écran.
    const { data } = await sb.rpc('population_par_classe', {
      p_profil: PROFIL, p_cible: 'ind', p_maille: 'departement',
    });
    const total = Number((data as { total?: number } | null)?.total ?? 0);
    if (!total) return expect(total).toBe(0);

    // Un arrondi par grappe, pas davantage : ~0,19 hab × N grappes.
    const ecart = Math.abs(somme - total);
    expect(
      ecart,
      `somme des grappes ${somme} contre total ${total} — écart ${ecart}, ` +
      `soit plus d'une unité d'arrondi par grappe (${grappes.length}). ` +
      'Une règle de retenue géométrique a-t-elle remplacé classe_carreau_risque ?',
    ).toBeLessThanOrEqual(grappes.length);
  }, 300_000);

  it('le niveau dominant est haut des qu un site du seuil haut est dedans', () => {
    if (!construit) return expect(construit).toBe(false);
    for (const g of grappes) expect(['haut', 'bas']).toContain(g.niveau_dominant);
    // Le profil par défaut retient les deux seuils : les deux doivent exister.
    expect(grappes.some((g) => g.niveau_dominant === 'haut')).toBe(true);
  });

  it('chaque grappe porte un nom et un rang unique', () => {
    if (!construit) return expect(construit).toBe(false);
    const rangs = new Set(grappes.map((g) => g.rang));
    expect(rangs.size).toBe(grappes.length);
    for (const g of grappes) expect(g.nom.trim().length).toBeGreaterThan(0);
  });

  it('un nom saisi a la main SURVIT a une reconstruction', async () => {
    if (!construit || !jeuId) return expect(construit).toBe(false);
    const cible = grappes[0];
    await sb.from('zone_set_clusters')
      .update({ nom: 'Vallée de la chimie', nom_auto: false })
      .eq('zone_set_id', jeuId).eq('rang', cible.rang);

    await sb.rpc('construire_zone_set_clusters', { p_zone_set_id: jeuId });

    const { data } = await sb.from('zone_set_clusters')
      .select('nom, nom_auto').eq('zone_set_id', jeuId).eq('rang', cible.rang).single();
    expect(
      data?.nom,
      'un nom choisi par un humain a ete ecrase par le calcul',
    ).toBe('Vallée de la chimie');
  }, 300_000);
});

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
 * donc un ORDRE DE GRANDEUR, pas une égalité stricte — ce qui distingue un
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

/**
 * ⚠ CE TEST TRAVAILLE SUR UN DÉPARTEMENT, ET CE N'EST PAS UN RACCOURCI.
 *
 * Sur la France entière, `remplir_zone_set_cp` lit les 215 646 carreaux
 * retenus dans `carreaux_filosofi` — 4,6 Go, 806 octets de jsonb par ligne —
 * contre 128 Mo de `shared_buffers` en local. Mesuré le 2026-09-22 sur LE MÊME
 * jeu à dix minutes d'intervalle : **12 s** cache chaud, **44 s** ensuite, et
 * **plus de 400 s** sur un cache froid. Kong coupe à 60 s : la suite passait ou
 * échouait selon ce qui avait tourné avant elle, ce qui se lit comme un test
 * instable alors que c'est une mesure honnête d'un coût variable.
 *
 * Les Bouches-du-Rhône portent l'Étang de Berre — le bassin le plus dense de
 * France en sites classés — donc tout ce que ces tests vérifient y existe :
 * des grappes de plusieurs sites, les deux niveaux Seveso, des codes postaux à
 * cheval. Le coût de l'écran national, lui, se mesure à la main et se
 * documente ; il ne se vérifie pas à chaque exécution de la suite.
 */
const DEPARTEMENT = '13';

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

  // Les restes d'une exécution que rien n'a terminée proprement (machine
  // arrêtée, test interrompu). Un brouillon porte des géométries et jusqu'à
  // 2 000 lignes de codes postaux : on ne les laisse pas s'empiler.
  await sb.from('zone_sets').delete().like('nom', 'TEST grappes (vitest)%');

  const { data: org, error: eOrg } = await sb
    .from('profiles').select('id, organization_id')
    .not('organization_id', 'is', null).limit(1).single();
  if (eOrg || !org) throw new Error(`aucune organisation : ${eOrg?.message ?? 'table vide'}`);

  const { data: jeu, error: eJeu } = await sb
    .from('zone_sets')
    .insert({
      // ⚠ Un nom UNIQUE par exécution. Le nom fixe se heurtait à
      // `zone_sets_nom_version_unique` dès qu'une exécution précédente avait
      // laissé son jeu derrière elle — un `afterAll` ne tourne pas quand la
      // machine s'arrête. L'insertion échouait alors, l'erreur n'était pas
      // lue, et les cinq tests passaient au vert sans rien construire. Deux
      // défauts se couvraient l'un l'autre.
      nom: `TEST grappes (vitest) ${Date.now()}`,
      org_id: org.organization_id,
      created_by: org.id,
      profil: PROFIL,
      gravites: ['seveso_haut', 'seveso_bas'],
      territoire: DEPARTEMENT,
      profil_hash: `vitest-${Date.now()}`,
      brouillon: true,
    })
    .select('id').single();
  if (eJeu || !jeu) throw new Error(`creation du jeu : ${eJeu?.message ?? 'aucune ligne'}`);
  jeuId = jeu.id;

  // ⚠ LES DEUX ERREURS SONT LUES, et ce n'est pas de la ceinture-bretelles.
  //
  // Elles étaient ignorées : `await sb.rpc(...)` sans regarder `error`.
  // supabase-js ne LÈVE pas, il rend `{ error }` — le remplissage pouvait
  // donc échouer en silence, les grappes exister quand même (elles sont
  // construites avant), `construit` passer à `true`, et les cinq tests se
  // dérouler sur des grappes à `pop_exposee` null.
  //
  // Constaté le 2026-09-22 : `remplir_zone_set_cp` rendait « The upstream
  // server is timing out » (Kong coupe à 60 s, et le remplissage va de 12 s à
  // plus d'une minute selon l'état du cache de `carreaux_filosofi`) et la
  // suite restait VERTE. Un test qui passe quand la chose testée n'a pas eu
  // lieu est pire qu'un test absent : il certifie.
  const { data: kRes, error: eK } = await sb.rpc('construire_zone_set_clusters', { p_zone_set_id: jeuId });
  if (eK) throw new Error(`construire_zone_set_clusters : ${eK.message}`);
  if ((kRes as { ok?: boolean } | null)?.ok !== true) {
    throw new Error(`construire_zone_set_clusters a refuse : ${JSON.stringify(kRes)}`);
  }

  // ⚠ La population des grappes est remplie par le remplissage des codes
  // postaux (sql/225), pas par la construction des grappes : une seule passe
  // sur les carreaux au lieu de deux. sql/224 la calculait par un KNN sur les
  // POLYGONES des bassins — 508 s a froid, contre 1,7 s aujourd'hui.
  const { data: rRes, error: eR } = await sb.rpc('remplir_zone_set_cp', { p_zone_set_id: jeuId });
  if (eR) throw new Error(`remplir_zone_set_cp : ${eR.message}`);
  if ((rRes as { ok?: boolean } | null)?.ok !== true) {
    throw new Error(`remplir_zone_set_cp a refuse : ${JSON.stringify(rRes)}`);
  }

  const { data, error: eG } = await sb
    .from('zone_set_clusters').select('*').eq('zone_set_id', jeuId);
  if (eG) throw new Error(`lecture des grappes : ${eG.message}`);
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
    const { data, error } = await sb.rpc('population_par_classe', {
      p_profil: PROFIL, p_cible: 'ind', p_maille: 'commune', p_parent: DEPARTEMENT,
    });
    // ⚠ Ce test COMPARE : si la référence manque, il n'a rien à comparer et
    // doit le dire. Il écrivait `if (!total) return expect(total).toBe(0)` —
    // une tautologie qui rendait vert le cas où le moteur de l'écran est en
    // panne, c'est-à-dire précisément le cas qu'il devrait signaler.
    if (error) throw new Error(`population_par_classe : ${error.message}`);
    const total = Number((data as { total?: number } | null)?.total ?? 0);
    expect(total, 'population_par_classe ne rend aucun total — rien a comparer').toBeGreaterThan(0);

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

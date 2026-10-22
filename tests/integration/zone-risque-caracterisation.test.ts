import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';

/**
 * Tests de CARACTÉRISATION de la zone à risque industriel.
 *
 * Ils ne disent pas ce que le code DEVRAIT faire : ils figent ce qu'il FAIT,
 * bizarreries comprises. C'est le filet sous lequel le refactor de
 * `docs/AUDIT_ZONE_RISQUE.md` s'exécute — si l'une de ces valeurs bouge, le
 * comportement observable a changé et le refactor a débordé.
 *
 * ── CE QU'ILS NE SONT PAS ─────────────────────────────────────────────────
 *
 * Ce ne sont pas des tests d'invariants : `exposition-invariants.test.ts` et
 * `couverture-rayon-invariants.test.ts` vérifient déjà des PROPRIÉTÉS (la somme
 * des lignes égale le total, un cumul ne redescend jamais). Ceux-ci vérifient
 * des VALEURS, mesurées le 2026-09-19 sur la base locale.
 *
 * Une valeur qui change n'est donc pas forcément un bug : si les données
 * changent (nouvel import ICPE, nouveau millésime de carreaux, nouveau
 * pré-calcul), il faut re-mesurer et mettre ce fichier à jour EN LE DISANT.
 * Ce qu'il interdit, c'est qu'elle change SANS qu'on l'ait voulu.
 */

// Client partagé : il reprend UNE fois sur 502/503, pour absorber la course
// sur les connexions persistantes entre Kong et PostgREST du stack local.
// Le diagnostic complet est dans `tests/integration/_client.ts`.
const sb = creerClientTest();

/** Bbox de l'Étang de Berre : le bassin industriel le plus dense de France. */
const BERRE: [number, number, number, number] = [4.9, 43.3, 5.4, 43.6];

interface Agregat {
  calculable: boolean;
  total_exposee: number;
  total_sites: number;
  lignes: unknown[];
}
interface Courbes {
  calculable: boolean;
  couverture_pct: number;
  n_bandes_construites: number;
  n_zones_lointaines: number;
  n_departements: number;
  courbes: { cle: string; points: { r: number; p: number; i: number }[] }[];
}
interface Carte {
  n_total: number;
  n_rendus: number;
  n_avec_pprt: number;
  rayon_m: number;
  features: { properties: { statut_zone: string } }[];
}

describe('zone à risque — caractérisation (valeurs mesurées le 2026-09-19)', () => {
  it('population_exposee_agregee au département rend 423 893 exposés sur 96 unités', async () => {
    const { data, error } = await sb.rpc('population_exposee_agregee', {
      p_dimension: 'departement',
      p_cible: 'ind',
      p_limite: 7000,
    });
    expect(error).toBeNull();
    const a = data as unknown as Agregat;
    expect(a.calculable).toBe(true);
    expect(a.total_exposee).toBe(423893);
    expect(a.total_sites).toBe(1259);
    expect(a.lignes.length).toBe(96);
  }, 60_000);

  it('la somme des lignes ÉGALE le total — un carreau appartient à une seule unité', async () => {
    const { data } = await sb.rpc('population_exposee_agregee', {
      p_dimension: 'departement',
      p_cible: 'ind',
      p_limite: 7000,
    });
    const a = data as unknown as Agregat;
    const somme = (a.lignes as { exposee: number }[]).reduce((t, l) => t + Number(l.exposee), 0);
    expect(somme).toBe(a.total_exposee);
  }, 60_000);

  it('lire_couverture_rayon : couverture 100 %, 120 bandes, 2 zones lointaines, 14 courbes', async () => {
    const { data, error } = await sb.rpc('lire_couverture_rayon', {
      p_cible: 'ind',
      p_gravites: null,
      p_natures: null,
      p_perim_niveau: null,
      p_perim_codes: null,
    });
    expect(error).toBeNull();
    const c = data as unknown as Courbes;
    expect(c.calculable).toBe(true);
    expect(c.couverture_pct).toBe(100);
    // Métropole SEULEMENT : les zones lointaines sont comptées à part (sql/201).
    // Les additionner portait le rapport à 112 % et faisait disparaître le
    // bandeau d'alerte, qui ne s'affiche que sous 99 %.
    expect(c.n_bandes_construites).toBe(120);
    expect(c.n_zones_lointaines).toBe(2);
    expect(c.n_departements).toBe(98);
    expect(c.courbes.length).toBe(14);
  }, 60_000);

  /*
   * ⚠ VALEUR RE-MESURÉE LE 2026-09-22, ET CE N'EST PAS UNE RÉGRESSION.
   *
   * Elle valait **42 409 940**, mesuré le 2026-09-19. Le 22, le volume Docker
   * a été effacé : `carreaux_filosofi` a été rechargé depuis le CSV INSEE
   * (`07-carreaux-insee.sh`) et `carreau_risque_distance` reconstruite. Le
   * carroyage n'est donc plus exactement celui d'avant.
   *
   * La nouvelle valeur a été VÉRIFIÉE contre une source indépendante avant
   * d'être écrite ici — la population des carreaux à moins de 10 km lue
   * directement dans la table des distances rend **41 025 586**, à 220
   * habitants de la courbe (le palier de 10 km est une borne fermée d'un côté,
   * ouverte de l'autre). Une valeur de caractérisation qu'on met à jour sans
   * la recouper ailleurs ne caractérise plus rien : elle enregistre ce que le
   * code fait, y compris quand il a tort.
   *
   * ⚠ 2026-10-22 (lot 4, T1) : CE TEST A ÉTÉ ROUGE PENDANT UN MOIS, ET LA
   * VALEUR ÉTAIT JUSTE. La base rendait de nouveau 42 409 940 : après une
   * restauration, `couverture_rayon_risque` portait une construction du
   * 2026-09-18 (journal `couverture_rayon_bandes`), antérieure aux distances du
   * 2026-09-19 dont elle dérive, et `11-reconstruire.sh` la sautait parce
   * qu'elle n'était pas vide. Reconstruite (`construire_couverture_rayon.mjs
   * --tout`, 122 bandes, 608 s), elle rend EXACTEMENT 41 025 366 ; la source
   * indépendante (`carreau_risque_distance`, distance au plus proche Seveso
   * ≤ 10 000 m, `sum(pops[1]::numeric)`) rend 41 025 586 sur 880 976 carreaux,
   * soit 220 d'écart, comme le 22/09. On n'a donc rien re-figé : on a remis la
   * donnée d'accord avec le test. Le script compare désormais les deux journaux.
   */
  it('la courbe totale atteint 41 025 366 habitants à 10 km d’un site Seveso', async () => {
    const { data } = await sb.rpc('lire_couverture_rayon', {
      p_cible: 'ind',
      p_gravites: null,
      p_natures: null,
      p_perim_niveau: null,
      p_perim_codes: null,
    });
    const c = data as unknown as Courbes;
    const totale = c.courbes.find((x) => x.cle === '*');
    expect(totale, 'la courbe totale doit porter la clé *').toBeDefined();
    const dernier = totale!.points[totale!.points.length - 1];
    expect(dernier.r).toBe(10000);
    expect(dernier.p).toBe(41025366);
  }, 60_000);

  it('compter_sites_rayon rend 1 259 sites répartis sur 14 natures', async () => {
    const { data, error } = await sb.rpc('compter_sites_rayon', {
      p_gravites: null,
      p_natures: null,
      p_perim_niveau: null,
      p_perim_codes: null,
    });
    expect(error).toBeNull();
    const r = data as unknown as { n_sites: number; par_nature: Record<string, number> };
    // `sum(n)` et non `count(*)` : la sous-requête est groupée par nature, un
    // `count(*)` aurait rendu 14 au lieu de 1 259.
    expect(r.n_sites).toBe(1259);
    expect(Object.keys(r.par_nature).length).toBe(14);
  }, 30_000);

  it('risques_industriels_carte sur l’Étang de Berre : 482 sites, 120 rattachés à un PPRT', async () => {
    const { data, error } = await sb.rpc('risques_industriels_carte', {
      p_bbox: BERRE,
      p_gravites: null,
      p_natures: null,
      p_inclure_inactifs: false,
      p_rayon_m: 500,
      p_limite: 2000,
    });
    expect(error).toBeNull();
    const c = data as unknown as Carte;
    expect(c.n_total).toBe(482);
    expect(c.n_rendus).toBe(482);
    expect(c.n_avec_pprt).toBe(120);
    expect(c.rayon_m).toBe(500);

    // `statut_zone` distingue une donnée qui MANQUE d'une zone qui n'existe pas
    // EN DROIT. Les confondre ferait passer une règle de droit pour une lacune
    // d'import — c'est l'invariant le plus important de cette RPC.
    const parStatut = c.features.reduce<Record<string, number>>((acc, f) => {
      acc[f.properties.statut_zone] = (acc[f.properties.statut_zone] ?? 0) + 1;
      return acc;
    }, {});
    expect(parStatut).toEqual({ pprt: 120, non_soumis: 4, non_concerne: 358 });
  }, 60_000);

  it('pprt_perimetres_carte sur l’Étang de Berre : 12 zones, tolérance plafonnée à 0,0001°', async () => {
    const { data, error } = await sb.rpc('pprt_perimetres_carte', {
      p_bbox: BERRE,
      p_types: null,
      p_limite: 500,
    });
    expect(error).toBeNull();
    const p = data as unknown as { n_total: number; n_rendus: number; tolerance_deg: number };
    expect(p.n_total).toBe(12);
    expect(p.n_rendus).toBe(12);
    // Plafonnée à ~11 m : un PPRT fait 2 m de large au minimum, et une tolérance
    // dérivée de l'étendue France en viderait 602 sur 664.
    expect(p.tolerance_deg).toBe(0.0001);
  }, 30_000);

  it('les référentiels du périmètre portent le compte attendu', async () => {
    for (const [table, attendu] of [
      ['cibles_exposition', 24],
      ['icpe_rubrique_familles', 15],
      ['pprt_perimetres', 664],
      ['pprt_documents', 415],
    ] as const) {
      const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
      expect(error, `${table}`).toBeNull();
      expect(count, `${table}`).toBe(attendu);
    }
  }, 30_000);
});

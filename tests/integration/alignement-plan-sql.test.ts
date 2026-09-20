/**
 * Le croisement entre `calculer_alignement_geo` et son jumeau TypeScript, sur
 * le cas qui n'avait jamais été croisé : des unités, des impressions, AUCUN
 * plan.
 *
 * ── POURQUOI CE TEST EXISTE ───────────────────────────────────────────────
 *
 * `ARCHITECTURE.md` affirme que la RPC et `lib/campagne/alignement.ts`
 * s'accordent « sur le chemin nominal et sur le cas dégénéré ». Les deux
 * croisements ont eu lieu à la main, une fois, en septembre — et leur en-tête
 * le signale comme une limite.
 *
 * Mesuré le 2026-09-20, ils DIVERGEAIENT sur un troisième cas :
 *
 *     campagne sans plan   SQL → score 100      TypeScript → score 0
 *
 * Les deux avaient tort. 0 se lit « campagne catastrophique », 100 se lit
 * « campagne parfaite » ; il n'y avait rien à juger. sql/209 et le jumeau
 * rendent désormais tous deux « non calculable ».
 *
 * ⚠ Ce test tourne à CHAQUE exécution de la suite d'intégration, contrairement
 * aux croisements manuels qu'il remplace.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { creerClientTest } from './_client';
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement';

const sb = creerClientTest();

/** La campagne de démonstration du module risque — sans plan, par construction. */
const SANS_PLAN = 'd0000000-0000-4000-8000-00000000f1a5';
/** La campagne de démonstration des élections — plan complet. */
const AVEC_PLAN = 'dccc0000-0000-4000-8000-000000000002';

interface Alignement {
  calculable: boolean;
  error?: string;
  score?: number;
  conformes_pct?: number;
  n_cp?: number;
  n_cp_plan?: number;
  plan_couverture_pct?: number;
}

async function rpc(id: string): Promise<Alignement> {
  const { data, error } = await sb.rpc('calculer_alignement_geo', {
    p_campaign_id: id, p_tolerance: null, p_poids: null,
  });
  if (error) throw new Error(`calculer_alignement_geo : ${error.message}`);
  return data as unknown as Alignement;
}

describe('« pas de plan » n est pas « plan parfaitement tenu »', () => {
  beforeAll(async () => {
    const { count } = await sb
      .from('dsp_campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('id', SANS_PLAN);
    if (!count) {
      throw new Error(
        'Le jeu de démonstration du module risque est absent. '
        + 'npx tsx scripts/seed-demo-campagne-risque.ts',
      );
    }
  }, 60_000);

  it('une campagne sans plan est NON CALCULABLE, et le dit', async () => {
    const r = await rpc(SANS_PLAN);
    expect(r.calculable).toBe(false);
    expect(r.error).toBe('plan_absent');
    // Le score ne doit PAS être rendu : ni 0, ni 100. Un champ absent ne peut
    // pas être affiché par erreur.
    expect(r.score).toBeUndefined();
    expect(r.n_cp_plan).toBe(0);
  }, 60_000);

  it('elle porte quand meme ses volumes — le diagnostic doit rester lisible', async () => {
    // Refuser de calculer ne veut pas dire refuser de renseigner : l'écran doit
    // pouvoir écrire « 2 000 codes postaux touchés, aucun plan défini ».
    const r = await rpc(SANS_PLAN);
    expect(r.n_cp).toBeGreaterThan(0);
  }, 60_000);

  it('le jumeau TypeScript refuse le MEME cas', () => {
    // Avant sql/209 : SQL 100, TypeScript 0. Les deux disent maintenant « non ».
    const unites: UniteAlignement[] = Array.from({ length: 2000 }, (_, i) => ({
      code: String(10000 + i), reel: 598166, plan: 0,
    }));
    expect(calculerAlignement(unites, 10, 1)).toBeNull();
  });

  it('une campagne avec plan reste calculable, et son score n a pas bouge', async () => {
    /*
     * Le contrepoids. Sans lui, un garde-fou trop zélé qui refuserait TOUJOURS
     * de calculer passerait les trois tests précédents.
     *
     * Les valeurs sont celles qu'`ARCHITECTURE.md` documente depuis le
     * 2026-09-14 : score 93, conformes 72,5 %, 2 041 CP.
     */
    const r = await rpc(AVEC_PLAN);
    expect(r.calculable).toBe(true);
    expect(r.score).toBe(93);
    expect(r.conformes_pct).toBe(72.5);
    expect(r.n_cp).toBe(2041);
  }, 60_000);

  it('la couverture du plan est exposee, et partielle sur la campagne elections', async () => {
    /*
     * 1 641 codes postaux planifiés sur 2 041, soit 80,4 %. Les ~400 autres
     * portent un plan NUL — ARCHITECTURE les documente comme « 19,6 % de la
     * campagne démo ».
     *
     * Exposer la couverture n'est pas cosmétique : un score calculé sur 12 %
     * des codes postaux touchés n'a pas la même valeur qu'un score calculé sur
     * la totalité, et rien ne le disait avant.
     */
    const r = await rpc(AVEC_PLAN);
    expect(r.n_cp_plan).toBeGreaterThan(0);
    expect(r.n_cp_plan).toBeLessThan(r.n_cp as number);
    expect(r.plan_couverture_pct).toBeGreaterThan(0);
    expect(r.plan_couverture_pct).toBeLessThan(100);
  }, 60_000);
});

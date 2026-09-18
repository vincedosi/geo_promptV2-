/**
 * Invariants de la courbe de couverture par rayon, rejoués CONTRE LA BASE.
 *
 * Complément de `tests/unit/risques/couverture-rayon-sql.test.ts` : celui-là
 * lit le SQL et attrape une régression au moment où elle est écrite ; celui-ci
 * interroge les données et attrape ce qu'aucune relecture ne voit — un
 * pré-calcul partiel, une bande oubliée, une courbe qui redescend.
 *
 * ── LA BASE VISÉE ─────────────────────────────────────────────────────────
 *
 * `.env.development.local` en priorité, donc le stack LOCAL. L'ordre de ces
 * deux lignes EST le garde-fou : avant le 2026-09-18 ces tests tapaient en
 * production avec la clé `service_role`.
 *
 * Les invariants sont STRUCTURELS : ils tiennent quelle que soit la
 * volumétrie. Sur une base locale partielle les totaux sont petits, mais les
 * égalités et les monotonies doivent être vraies quand même.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envLocalDev = path.resolve(process.cwd(), '.env.development.local');
const envLocal = path.resolve(process.cwd(), '.env.local');
const envPath = fs.existsSync(envLocalDev) ? envLocalDev : envLocal;
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISPO = !!(URL && KEY);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sb: any;

interface Point { r: number; p: number; i: number }
interface Courbe { cle: string; total: number; carreaux: number; points: Point[] }
interface Reponse { calculable: boolean; courbes: Courbe[]; rayon_max_m: number; total_est_global: boolean }

beforeAll(() => {
  if (DISPO) sb = createClient(URL as string, KEY as string, { auth: { persistSession: false } });
});

async function lire(params: Record<string, unknown> = {}): Promise<Reponse> {
  const { data, error } = await sb.rpc('lire_couverture_rayon', params);
  expect(error, `RPC en erreur : ${error?.message}`).toBeNull();
  return data as Reponse;
}

/** Le pré-calcul est-il présent ? Sans lui, les invariants n'ont rien à dire. */
async function construit(): Promise<boolean> {
  const { count } = await sb
    .from('couverture_rayon_risque')
    .select('*', { count: 'exact', head: true });
  return (count ?? 0) > 0;
}

describe.skipIf(!DISPO)('couverture par rayon — invariants sur la base', () => {
  it('le pré-calcul existe, sinon rien de ce qui suit n’a de sens', async () => {
    const ok = await construit();
    // Ce n'est PAS un échec de code : la table se construit par
    // `scripts/construire_couverture_rayon.mjs`. Le test le dit clairement
    // plutôt que de laisser dix tests échouer pour une donnée absente.
    expect(ok, 'couverture_rayon_risque est vide — lancer scripts/construire_couverture_rayon.mjs').toBe(true);
  });

  it('chaque courbe est CROISSANTE — un cumul ne redescend jamais', async () => {
    if (!(await construit())) return;
    const r = await lire({ p_cible: 'ind' });
    for (const c of r.courbes) {
      let precedent = -1;
      for (const pt of c.points) {
        expect(pt.p, `${c.cle} redescend à ${pt.r} m`).toBeGreaterThanOrEqual(precedent);
        precedent = pt.p;
      }
    }
  });

  it('chaque courbe couvre la grille ENTIÈRE, 100 à 10 000 par pas de 100', async () => {
    if (!(await construit())) return;
    const r = await lire({ p_cible: 'ind' });
    for (const c of r.courbes) {
      expect(c.points.length, `${c.cle} : grille incomplète`).toBe(100);
      expect(c.points[0].r).toBe(100);
      expect(c.points[c.points.length - 1].r).toBe(10000);
      // Pas régulier : un trou décalerait tous les paliers suivants.
      for (let i = 1; i < c.points.length; i++) {
        expect(c.points[i].r - c.points[i - 1].r).toBe(100);
      }
    }
  });

  it('la courbe TOTALE ne dépasse jamais la somme des natures', async () => {
    if (!(await construit())) return;
    // C'EST l'invariant du double comptage. Le total vient du minimum par
    // carreau ; la somme des natures compte deux fois les habitants proches
    // de deux natures. Mesuré en local : 240 745 contre 282 502.
    const r = await lire({ p_cible: 'ind' });
    const totale = r.courbes.find((c) => c.cle === '*');
    expect(totale, 'la courbe « toutes natures » doit exister').toBeDefined();
    const sommeNatures = r.courbes
      .filter((c) => c.cle !== '*')
      .reduce((s, c) => s + Number(c.total), 0);
    expect(Number(totale!.total)).toBeLessThanOrEqual(sommeNatures);
  });

  it('la courbe totale domine chacune des courbes par nature', async () => {
    if (!(await construit())) return;
    // Un habitant proche d'une nature est, par construction, proche d'au moins
    // un site : le total ne peut pas être inférieur à une de ses composantes.
    const r = await lire({ p_cible: 'ind' });
    const totale = r.courbes.find((c) => c.cle === '*');
    if (!totale) return;
    for (const c of r.courbes) {
      if (c.cle === '*') continue;
      expect(Number(totale.total), `${c.cle} dépasse le total`).toBeGreaterThanOrEqual(Number(c.total));
    }
  });

  it('la somme des incréments égale le cumul final', async () => {
    if (!(await construit())) return;
    // Critère d'acceptation explicite de la spec. Les incréments sont écrits
    // par palier, le cumul par fonction de fenêtrage : s'ils divergent, l'un
    // des deux est faux.
    const r = await lire({ p_cible: 'ind' });
    for (const c of r.courbes) {
      const somme = c.points.reduce((s, pt) => s + Number(pt.i), 0);
      const final = Number(c.points[c.points.length - 1].p);
      // Tolérance d'une unité : chaque valeur est arrondie côté base.
      expect(Math.abs(somme - final), `${c.cle} : ${somme} ≠ ${final}`).toBeLessThanOrEqual(1);
    }
  });

  it('une sous-population reste inférieure à la population totale', async () => {
    if (!(await construit())) return;
    const [tous, jeunes] = await Promise.all([
      lire({ p_cible: 'ind' }),
      lire({ p_cible: 'ind_18_24' }),
    ]);
    const t = tous.courbes.find((c) => c.cle === '*');
    const j = jeunes.courbes.find((c) => c.cle === '*');
    if (!t || !j) return;
    expect(Number(j.total)).toBeLessThan(Number(t.total));
  });

  it('un périmètre ne peut que RÉDUIRE la couverture', async () => {
    if (!(await construit())) return;
    const france = await lire({ p_cible: 'ind' });
    const { data: deps } = await sb
      .from('couverture_rayon_risque')
      .select('code_departement')
      .limit(1);
    const dep = deps?.[0]?.code_departement;
    if (!dep) return;
    const local = await lire({
      p_cible: 'ind', p_perim_niveau: 'departement', p_perim_codes: [dep],
    });
    const tf = Number(france.courbes.find((c) => c.cle === '*')?.total ?? 0);
    const tl = Number(local.courbes.find((c) => c.cle === '*')?.total ?? 0);
    expect(tl).toBeLessThanOrEqual(tf);
  });

  it('une cible inconnue est refusée, pas calculée au hasard', async () => {
    const { data } = await sb.rpc('lire_couverture_rayon', { p_cible: 'colonne_absente' });
    expect((data as { calculable: boolean }).calculable).toBe(false);
    expect((data as { error?: string }).error).toBe('cible_inconnue');
  });

  it('filtrer les natures prévient que le total reste global', async () => {
    if (!(await construit())) return;
    const r = await lire({ p_cible: 'ind', p_natures: ['Toxicité aiguë'] });
    // Le drapeau existe pour que l'écran DISE que la courbe totale porte sur
    // toutes les natures, pas seulement sur celles affichées.
    expect(r.total_est_global).toBe(true);
    // Et la courbe totale est toujours rendue.
    expect(r.courbes.some((c) => c.cle === '*')).toBe(true);
  });
});

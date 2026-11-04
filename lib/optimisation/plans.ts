/**
 * @file lib/optimisation/plans.ts — les calculs portés en Python, branchés sur leurs appelants Next sous drapeau.
 *
 * Trois calculs, une fonction chacun ; chacune rend le résultat dans la forme EXACTE qu'attendait l'appelant, quelle que
 * soit la source (`drapeaux.ts`) :
 * - `planRisqueSousDrapeau` — `genererPlanCp` (extraction risque, `rattacher`, `export`, `cp-geo`) ↔ `/v1/plans/risque` ;
 * - `plansZoneSousDrapeau` — `plansParPlateforme` + `planCpDeZone` + `sortiesPoids` (extraction d'un jeu de ZONE)
 *   ↔ `/v1/plans/zone` ;
 * - `recalageSousDrapeau` — `recaler` (`simulation/recaler`) ↔ `/v1/historique/recaler`.
 *
 * En mode `python`, la sortie du service est rendue « telle quelle » dans le type TS : sa forme est garantie par Zod
 * (`schemas.ts`, aligné sur l'OpenAPI), ses valeurs par la parité au bit près (pytest, 0 écart sur les fixtures TS),
 * et l'ombre la mesure en conditions réelles avant toute bascule.
 */
import { NextResponse } from 'next/server';
import { calculerPlanRisque, calculerPlanZone, calculerRecalage, ErreurOptimisation } from '@/lib/optimisation/client';
import { sourceCorrection, sourcePlan } from '@/lib/optimisation/drapeaux';
import { calculerSousDrapeau, type Issue } from '@/lib/optimisation/ombre';
import type { EntreePlanZone, SortiePlanZone } from '@/lib/optimisation/schemas';
import type { Avertissement } from '@/lib/zones/conversion';
import type { LigneCouverture } from '@/lib/zones/couverture';
import type { JeuDeZones } from '@/lib/zones/jeu';
import { genererPlanCp, type CpZone, type MembresParCanonique, type Plan } from '@/lib/zones/plan';
import {
  planCpDeZone, plansParPlateforme, sortiesPoids,
  type PlanPlateforme, type ReglagePlan, type SortiePoids, type VolumesAttendus,
} from '@/lib/zones/plan-jeu-zone';
import type { PlateformePoids } from '@/lib/zones/plateformes';
import type { Recette } from '@/lib/zones/recette';
import { recaler, type Recalage } from '@/lib/simulation/recalage';
import type { CpSimulation, ParamsSimulation } from '@/lib/simulation/types';

/** Retire `algo` d'un objet (le TS ne le calcule pas : il n'entre pas dans la comparaison). */
function sansAlgo<T extends { algo?: unknown }>(v: T): Omit<T, 'algo'> {
  const { algo: _algo, ...reste } = v;
  return reste;
}

const objetDeGroupes = (g?: MembresParCanonique): Record<string, string[]> =>
  Object.fromEntries([...(g ?? new Map<string, readonly string[]>())].map(([k, v]) => [k, [...v]]));

/**
 * La réponse HTTP d'une `ErreurOptimisation` en mode `python` (en `ombre`, elle n'atteint jamais l'appelant) : 503 pour
 * un service absent, lent ou occupé, 502 pour une réponse fausse, 422 pour un refus. Le message est déjà français.
 */
export function reponseErreurOptimisation(e: unknown, contexte: string): NextResponse {
  const err = e instanceof ErreurOptimisation
    ? e
    : new ErreurOptimisation("Erreur du service d'optimisation : le calcul n'a pas abouti.", 'serveur');
  console.error(`[optimisation] ${contexte} :`, err.motif, err.message);
  const statut = err.motif === 'refus' ? 422 : err.motif === 'serveur' || err.motif === 'reponse' ? 502 : 503;
  return NextResponse.json({ error: err.message }, { status: statut });
}

// ── Plan d'un jeu RISQUE ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `genererPlanCp(cps, jeu, groupes)` sous `OPTIMISATION_PLAN_SOURCE`. En `python`, lève `ErreurOptimisation`.
 *
 * @param appelant nom stable dans le journal de l'ombre (`extraction_risque`, `rattacher`, `export`, `cp_geo`)
 */
export function planRisqueSousDrapeau(
  appelant: string, cps: CpZone[], jeu: Pick<JeuDeZones, 'mode_plan' | 'poids'>, groupes?: MembresParCanonique,
): Promise<Issue<Plan>> {
  return calculerSousDrapeau({
    appelant,
    source: sourcePlan(),
    ts: () => genererPlanCp(cps, jeu, groupes),
    python: (delai) => calculerPlanRisque({
      cps: cps.map((c) => ({
        code_postal: c.code_postal, classe: c.classe, pop_en_zone: c.pop_en_zone, pop_totale: c.pop_totale,
        retenu: c.retenu,
      })),
      jeu: { mode_plan: jeu.mode_plan, poids: { ...jeu.poids } },
      groupes: objetDeGroupes(groupes),
    }, delai),
    comparableTs: (plan) => plan,
    comparablePython: (py) => sansAlgo(py),
    versTs: (py) => {
      const { multiplicateur, ...plan } = sansAlgo(py);
      // Sémantique `repartition` : pas de bilan d'écrêtage (absent du type TS, jamais `null`).
      return (multiplicateur ? { ...plan, multiplicateur } : plan) as Plan;
    },
    algo: (py) => py.algo,
  });
}

// ── Plans CP d'un jeu de ZONE ────────────────────────────────────────────────────────────────────────────────────────

/** Ce que l'extraction d'un jeu de zone tire du calcul : plan commun, plans propres, sorties de poids de chacun. */
export interface PlansZone {
  commun: ReturnType<typeof planCpDeZone>;
  parPlateforme: PlanPlateforme[];
  /** Par plateforme : ce que le plan COMMUN enverrait, compté sur les codes de SA conversion. */
  sortiesCommun: Map<string, { sorties: SortiePoids[]; avertissements: Avertissement[] }>;
  /** Par plateforme : ce que SON plan enverrait. */
  sortiesPropres: Map<string, { sorties: SortiePoids[]; avertissements: Avertissement[] }>;
}

type ResultatZone = { ok: true; plans: PlansZone } | { ok: false; message: string };

export interface EntreesPlansZone {
  lignes: readonly LigneCouverture[];
  /** Les plateformes au CP, chacune avec le nombre de codes que SA conversion a retenus (`n_codes ?? n_unites`). */
  choix: readonly { plateforme: string; seuil: number; n_codes_conversion: number }[];
  mode: 'pondere' | 'exclusif';
  groupes: MembresParCanonique;
  liste?: readonly string[];
  recette: Recette | null;
  /** Le réglage commun (`reglageDuPlan` de toutes les plateformes au CP), et le registre lu. */
  reglage: ReglagePlan;
  poids: readonly PlateformePoids[];
  /** Les volumes attendus : lus par le TS (absents en mode `python`, où le service les lit lui-même). */
  lireVolumes: () => Promise<VolumesAttendus>;
}

function plansZoneTs(e: EntreesPlansZone, volumes: VolumesAttendus): ResultatZone {
  const propres = plansParPlateforme(e.lignes, e.choix, e.mode, e.groupes, e.poids, e.liste, volumes);
  if (!propres.ok) return { ok: false, message: propres.message };
  const commun = planCpDeZone(
    e.lignes, Math.min(...e.choix.map((c) => c.seuil)), e.mode, e.groupes, e.liste, e.reglage, volumes);
  const sortiesCommun = new Map<string, { sorties: SortiePoids[]; avertissements: Avertissement[] }>();
  const sortiesPropres = new Map<string, { sorties: SortiePoids[]; avertissements: Avertissement[] }>();
  for (const p of propres.plans) {
    const c = e.choix.find((x) => x.plateforme === p.plateforme);
    if (!c) continue;
    sortiesCommun.set(p.plateforme, sortiesPoids(e.poids, p.plateforme, c.n_codes_conversion, commun.resume.multiplicateur));
    sortiesPropres.set(p.plateforme,
      sortiesPoids(e.poids, p.plateforme, p.plan.resume.n_codes, p.plan.resume.multiplicateur));
  }
  return { ok: true, plans: { commun, parPlateforme: propres.plans, sortiesCommun, sortiesPropres } };
}

/** L'entrée de `/v1/plans/zone` : les seuls champs que le plan lit (les champs d'affichage restent à Next). */
function entreeZone(e: EntreesPlansZone): EntreePlanZone {
  const r = e.recette;
  return {
    couverture: e.lignes.map((l) => ({
      code: l.code,
      pop_en_zone: l.pop_en_zone,
      pop_totale: l.pop_totale,
      part: l.part,
      part_brute: l.part_brute,
      // Une liste vide vaut une liste absente pour `membresDe` ; le service exige ≥ 1 membre.
      membres: l.membres && l.membres.length > 0 ? [...l.membres] : null,
      incluse: typeof l.incluse === 'boolean' ? l.incluse : null,
    })),
    choix: e.choix.map((c) => ({ plateforme: c.plateforme as EntreePlanZone['choix'][number]['plateforme'],
      seuil: c.seuil, n_codes_conversion: c.n_codes_conversion })),
    mode_plan: e.mode,
    groupes: objetDeGroupes(e.groupes),
    codes_exacts: e.liste ? [...e.liste] : null,
    // `universDeZone` ne lit que le type et, pour un pays, son code.
    recette: r ? { type: r.type, code: r.type === 'pays' ? r.code : null } : null,
  };
}

/** Rend la sortie du service dans la forme du TS (`PlansZone`) ; le résumé commun garde son `algo`. */
function versPlansZone(py: SortiePlanZone): PlansZone {
  const versMap = (l: readonly { plateforme: string; poids: unknown; avertissements: unknown }[]) => new Map(
    l.map((x) => [x.plateforme, {
      sorties: x.poids as SortiePoids[], avertissements: x.avertissements as Avertissement[],
    }]));
  return {
    commun: py.commun as unknown as PlansZone['commun'],
    parPlateforme: py.par_plateforme.map((p) => ({
      plateforme: p.plateforme, seuil: p.seuil, reglage: p.reglage as ReglagePlan,
      plan: p.plan as unknown as PlanPlateforme['plan'],
    })),
    sortiesCommun: versMap(py.sorties_poids),
    sortiesPropres: versMap(py.par_plateforme),
  };
}

/** Les deux côtés ramenés à la forme de la réponse du service (sans `algo`). */
function comparableZone(r: ResultatZone, reglage: ReglagePlan): unknown {
  if (!r.ok) return { refus: r.message };
  const p = r.plans;
  return {
    commun: p.commun,
    reglage,
    par_plateforme: p.parPlateforme.map((x) => ({
      plateforme: x.plateforme, seuil: x.seuil, reglage: x.reglage, plan: x.plan,
      poids: p.sortiesPropres.get(x.plateforme)?.sorties, avertissements: p.sortiesPropres.get(x.plateforme)?.avertissements,
    })),
    sorties_poids: p.parPlateforme.map((x) => ({
      plateforme: x.plateforme,
      poids: p.sortiesCommun.get(x.plateforme)?.sorties, avertissements: p.sortiesCommun.get(x.plateforme)?.avertissements,
    })),
  };
}

type IssuePython = { ok: true; sortie: SortiePlanZone } | { ok: false; message: string };

/**
 * Le calcul CP d'une extraction de jeu de zone sous `OPTIMISATION_PLAN_SOURCE`. Un refus du registre (une plateforme
 * sans mécanisme au CP) est un RÉSULTAT des deux côtés, comparé comme tel. En `python`, une panne lève
 * `ErreurOptimisation` ; une lecture de volumes en échec lève l'erreur de `lireVolumes` (ts et ombre).
 */
export async function plansZoneSousDrapeau(e: EntreesPlansZone): Promise<Issue<ResultatZone>> {
  const source = sourcePlan();
  // Mode `python` : le service lit lui-même les volumes ; le TS ne fait pas cette lecture pour rien.
  const volumes = source === 'python' ? null : await e.lireVolumes();
  const reglageCommun = e.reglage;
  const issue = await calculerSousDrapeau<ResultatZone, IssuePython>({
    appelant: 'extraction_zone',
    source,
    ts: () => plansZoneTs(e, volumes as VolumesAttendus),
    python: async (delai) => {
      try {
        return { ok: true, sortie: await calculerPlanZone(entreeZone(e), delai) };
      } catch (err) {
        if (err instanceof ErreurOptimisation && err.refus === 'registre') return { ok: false, message: err.message };
        throw err;
      }
    },
    comparableTs: (r) => comparableZone(r, reglageCommun),
    comparablePython: (py) => {
      if (!py.ok) return { refus: py.message };
      const { commun, ...reste } = sansAlgo(py.sortie);
      return { ...reste, commun: { lignes: commun.lignes, resume: sansAlgo(commun.resume) } };
    },
    versTs: (py) => (py.ok ? { ok: true, plans: versPlansZone(py.sortie) } : { ok: false, message: py.message }),
    // Un refus n'a pas d'empreinte : l'`algo` est celui d'un plan rendu.
    algo: (py) => (py.ok ? py.sortie.algo : null),
  });
  return issue;
}

// ── Recalage amorti (correction historique) ──────────────────────────────────────────────────────────────────────────

/**
 * `recaler(cps, observees, cible, P)` sous `OPTIMISATION_CORRECTION_SOURCE`. Les `Map` voyagent en listes de paires
 * (ordre d'insertion conservé : un code postal est une clé « numérique » qu'un objet JSON déplacerait).
 */
export function recalageSousDrapeau(
  cps: CpSimulation[], observees: Map<string, number>, cible: Map<string, number>, P: ParamsSimulation,
): Promise<Issue<Recalage>> {
  const enPaires = (r: Recalage) => ({
    multiplicateurs: [...r.multiplicateurs], corrections: [...r.corrections], dilues: r.dilues,
  });
  return calculerSousDrapeau({
    appelant: 'simulation_recaler',
    source: sourceCorrection(),
    ts: () => recaler(cps, observees, cible, P),
    python: (delai) => calculerRecalage({
      cps: cps.map((c) => ({
        code_postal: c.code_postal, cluster_id: c.cluster_id, multiplicateur: c.multiplicateur,
        part_en_zone: c.part_en_zone,
      })),
      utiles_observees: [...observees],
      cible: [...cible],
      params: { amortissement: P.amortissement, seuilDilution: P.seuilDilution, baisseDilues: P.baisseDilues },
    }, delai),
    comparableTs: enPaires,
    comparablePython: (py) => sansAlgo(py),
    versTs: (py) => ({
      multiplicateurs: new Map(py.multiplicateurs), corrections: new Map(py.corrections), dilues: [...py.dilues],
    }),
    algo: (py) => py.algo,
  });
}

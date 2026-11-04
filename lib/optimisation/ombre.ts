/**
 * @file lib/optimisation/ombre.ts — exécuter un calcul sous drapeau, et en mode `ombre`, comparer TS et Python.
 *
 * MODE OMBRE (plan § 5) : le TS calcule et reste la valeur servie ; Python calcule la même chose ; l'écart est compté et
 * journalisé en UNE ligne JSON par appel (`evenement: 'optimisation_ombre'` : appelant, nombre d'écarts, premier écart,
 * durée, empreinte des entrées côté Python) — de quoi décider la bascule sur des chiffres. Une panne de Python (délai,
 * service arrêté, réponse illisible), ou même un défaut de la comparaison, est journalisée et AVALÉE : le TS n'est
 * jamais interrompu ni modifié.
 *
 * COMPARAISON : valeurs PARSÉES, jamais le texte (`json_js.py` écrit `3.2e-05` là où JS écrit `0.000032`). Le côté TS
 * passe d'abord par `JSON.parse(JSON.stringify(…))` : ce qui est comparé est ce que le TS ÉCRIT (une clé `undefined`
 * disparaît, `-0` devient `0`), exactement comme Python l'écrit. Égalité STRICTE des nombres, à tolérance nulle — la
 * parité est au bit près (rapports des lots 1 et 2) ; un écart d'un ulp est un écart.
 */
import { DELAI_OPTIMISATION_MS, ErreurOptimisation } from '@/lib/optimisation/client';
import type { SourceCalcul } from '@/lib/optimisation/drapeaux';
import type { Algo } from '@/lib/optimisation/schemas';

/**
 * 10 s en ombre (30 s en mode `python`) : l'ombre ne sert pas la réponse, elle ne doit pas la retarder plus qu'il ne
 * faut. Un plan national se calcule en ≈ 1 s.
 */
export const DELAI_OMBRE_MS = 10_000;

/** Longueur maximale d'une valeur citée dans le journal (un plan entier n'y a pas sa place). */
const CITATION_MAX = 200;

interface Ecart {
  /** Chemin JSON (`commun.lignes.12.multiplicateur`) ; `.length` pour deux tableaux de longueurs différentes. */
  chemin: string;
  ts: unknown;
  python: unknown;
}

export interface Comparaison {
  ecarts: number;
  premier: Ecart | null;
}

const ABSENT = '(absent)';

function citer(v: unknown): unknown {
  if (v === undefined) return ABSENT;
  if (v === null || typeof v !== 'object') return v;
  const texte = JSON.stringify(v);
  return texte.length > CITATION_MAX ? `${texte.slice(0, CITATION_MAX)}…` : v;
}

/** Ce que le TS écrit : la valeur après un aller-retour JSON. */
export function versJson(v: unknown): unknown {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * Compte les écarts feuille par feuille entre deux valeurs JSON. Les clés d'objet sont comparées comme ENSEMBLE (l'ordre
 * des clés d'un objet n'est pas une donnée ; celui d'une `Map` l'est, et voyage en tableau de paires) ; les tableaux,
 * élément par élément, plus un écart si les longueurs diffèrent.
 */
export function comparer(ts: unknown, python: unknown): Comparaison {
  let ecarts = 0;
  let premier: Ecart | null = null;
  const noter = (chemin: string, a: unknown, b: unknown) => {
    ecarts += 1;
    if (!premier) premier = { chemin: chemin || '(racine)', ts: citer(a), python: citer(b) };
  };
  const visiter = (a: unknown, b: unknown, chemin: string) => {
    const joindre = (k: string | number) => (chemin ? `${chemin}.${k}` : String(k));
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) noter(joindre('length'), a.length, b.length);
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) visiter(a[i], b[i], joindre(i));
      return;
    }
    const objet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (objet(a) && objet(b)) {
      const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of [...cles].sort()) {
        if (!(k in a)) noter(joindre(k), undefined, b[k]);
        else if (!(k in b)) noter(joindre(k), a[k], undefined);
        else visiter(a[k], b[k], joindre(k));
      }
      return;
    }
    // Feuilles (et types différents) : égalité stricte ; `-0 === 0`, comme le JSON qui n'écrit pas `-0`.
    if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) noter(chemin, a, b);
  };
  visiter(ts, python, '');
  return { ecarts, premier };
}

/** Ce que l'ombre a constaté, pour le journal et, quand l'appelant le fige, pour `resume_plan.algo` (sql/344). */
interface ResultatOmbre {
  ecarts: number | null;
  algo: Algo | null;
  erreur: string | null;
}

export interface CalculSousDrapeau<TS, PY> {
  /** Nom stable de l'appelant dans le journal (`extraction_zone`, `rattacher`…). */
  appelant: string;
  source: SourceCalcul;
  /** Le calcul TypeScript, tel qu'avant. */
  ts: () => TS;
  /** L'appel au service ; reçoit le délai à appliquer (plus court en ombre). */
  python: (delaiMs: number) => Promise<PY>;
  /** Les deux valeurs ramenées à la MÊME forme comparable (objets JSON). */
  comparableTs: (v: TS) => unknown;
  comparablePython: (v: PY) => unknown;
  /** Mode `python` : la sortie Python dans la forme qu'attend l'appelant. */
  versTs: (v: PY) => TS;
  /** L'`algo` rendu par Python (empreinte des entrées) ; `null` pour un résultat qui n'en porte pas (refus). */
  algo: (v: PY) => Algo | null;
}

export interface Issue<TS> {
  valeur: TS;
  /** Présent en `ombre` seulement. */
  ombre?: ResultatOmbre;
  /** Présent en `python` seulement : l'`algo` de la valeur rendue (`null` pour un refus). */
  algo?: Algo | null;
}

function journal(ligne: Record<string, unknown>): void {
  console.info(JSON.stringify({ evenement: 'optimisation_ombre', ...ligne }));
}

/**
 * Exécute un calcul selon sa source.
 * - `ts` : le TS seul, rien d'autre (aucun appel, aucun journal) ;
 * - `ombre` : le TS, puis Python ; écart journalisé ; le TS est rendu même si Python échoue ;
 * - `python` : Python seul ; une `ErreurOptimisation` remonte à l'appelant, qui la dit à l'utilisateur.
 */
export async function calculerSousDrapeau<TS, PY>(c: CalculSousDrapeau<TS, PY>): Promise<Issue<TS>> {
  if (c.source === 'python') {
    const py = await c.python(DELAI_OPTIMISATION_MS);
    return { valeur: c.versTs(py), algo: c.algo(py) };
  }

  const valeur = c.ts();
  if (c.source !== 'ombre') return { valeur };

  const t0 = Date.now();
  try {
    const py = await c.python(DELAI_OMBRE_MS);
    const algo = c.algo(py);
    const { ecarts, premier } = comparer(versJson(c.comparableTs(valeur)), c.comparablePython(py));
    journal({
      appelant: c.appelant, ecarts, premier_ecart: premier, duree_python_ms: Date.now() - t0,
      entrees_sha256: algo?.entrees_sha256 ?? null, version: algo?.version ?? null,
    });
    return { valeur, ombre: { ecarts, algo, erreur: null } };
  } catch (e) {
    const motif = e instanceof ErreurOptimisation ? e.motif : 'comparaison';
    const message = e instanceof Error ? e.message : String(e);
    journal({
      appelant: c.appelant, ecarts: null, premier_ecart: null, duree_python_ms: Date.now() - t0,
      erreur: { motif, message },
    });
    return { valeur, ombre: { ecarts: null, algo: null, erreur: message } };
  }
}

/**
 * `resume_plan.algo` (sql/344) selon la source : rien en `ts` (le résumé reste celui d'avant), l'`algo` de Python en
 * `python`, et en `ombre` le moteur écrit (`ts`) avec ce que l'ombre a constaté.
 */
export function algoAFiger(issue: Issue<unknown>): Record<string, unknown> | undefined {
  if (issue.algo) return { ...issue.algo };
  if (!issue.ombre) return undefined;
  const o = issue.ombre;
  return {
    moteur: 'ts',
    // `ecarts` null = Python n'a pas répondu (l'`erreur` dit pourquoi) ; 0 = identique au TS.
    ombre: { ...(o.algo ?? { moteur: 'python' }), ecarts: o.ecarts, ...(o.erreur ? { erreur: o.erreur } : {}) },
  };
}

/**
 * @file lib/analyses/types.ts — l'analyse comme objet enregistré, rejouable.
 *
 * Tâche 11 (2026-09-12) : une analyse lancée depuis la carte (clustering,
 * scoring, bataille, voronoï, corrélation, ELM) devient une ligne de
 * `public.analyses` (sql/145) — nom, paramètres complets, maillage, périmètre,
 * date. Auparavant, seul le clustering laissait une trace
 * (`clustering_models` / `clustering_jobs`) ; les autres calculs ne
 * survivaient pas à la fermeture du panneau.
 *
 * Consommé par les routes `app/api/analyses/*`, par Calques > Mes analyses
 * (`PanneauCalques.tsx`, Tâche 6) et, plus tard, par les Tâches 12/13/22 qui
 * enregistreront leurs propres lancements dans cette même table.
 */
import type { TableRow } from '@/lib/supabase/tables';

/**
 * Types d'analyse. DOIT rester synchronisé avec la contrainte
 * `CHECK (type IN (...))` de `sql/145_analyses_enregistrees.sql` — c'est une
 * frontière que le générateur de types Supabase ne couvre pas : une colonne
 * `text` + `CHECK` sort en `string` côté généré (voir ARCHITECTURE.md,
 * section « Types générés branchés »), jamais en union littérale.
 * Toute évolution de la contrainte SQL doit être répercutée ICI dans le même
 * commit, comme `lib/auth/roles.ts` le fait pour `profiles.role`.
 *
 * Source unique côté TypeScript : les routes `app/api/analyses/*` dérivent
 * leur schéma Zod de `TYPES_ANALYSE` plutôt que de recopier les six littéraux.
 */
export const TYPES_ANALYSE = ['clusters', 'score', 'battle', 'voronoi', 'correlation', 'elm'] as const;
export type TypeAnalyse = (typeof TYPES_ANALYSE)[number];

/** `statut`, même remarque : synchronisé avec le `CHECK` de la table. */
export const STATUTS_ANALYSE = ['en_cours', 'termine', 'echec'] as const;
export type StatutAnalyse = (typeof STATUTS_ANALYSE)[number];

/**
 * Une analyse enregistrée — forme applicative de `TableRow<'analyses'>`, avec
 * `type`/`statut` resserrés en unions littérales plutôt qu'en `string` généré.
 */
export interface AnalyseEnregistree extends Omit<TableRow<'analyses'>, 'type' | 'statut'> {
  type: TypeAnalyse;
  statut: StatutAnalyse;
}

/**
 * Trie récursivement les clés d'un objet, sans toucher à l'ordre des tableaux.
 * Les tableaux sont parcourus (pour trier les objets qu'ils contiennent),
 * jamais réordonnés : leur ordre est signifiant (ex. polygone, séquence de
 * paliers) alors que celui des clés JSON ne l'est pas.
 */
function trierClesRecursivement(valeur: unknown): unknown {
  if (Array.isArray(valeur)) {
    return valeur.map(trierClesRecursivement);
  }
  // Une `Date` DOIT être traitée ici, avant la branche « objet » : `Object.keys`
  // d'une date rend `[]`, donc le tri la réduirait à `{}` et DEUX DATES
  // DIFFÉRENTES produiraient la même clé. Le remplaçant de `JSON.stringify`
  // ne peut pas rattraper le coup — il ne voit que ce que cette fonction lui
  // laisse. (Défaut trouvé par le test de ce cas, pas par relecture : la
  // première version du durcissement plaçait la garde dans le remplaçant.)
  if (valeur instanceof Date) {
    return `@date:${valeur.toISOString()}`;
  }
  if (valeur !== null && typeof valeur === 'object') {
    const objet = valeur as Record<string, unknown>;
    const clesTriees = Object.keys(objet).sort();
    const resultat: Record<string, unknown> = {};
    for (const cle of clesTriees) {
      resultat[cle] = trierClesRecursivement(objet[cle]);
    }
    return resultat;
  }
  return valeur;
}

/**
 * Clé stable des paramètres d'un lancement — sert à reconnaître un rejeu à
 * l'identique (Tâches 12/13/22 : « ce lancement a-t-il déjà été fait ? »).
 *
 * Stable à l'ordre des clés JSON près (`{a:1,b:2}` et `{b:2,a:1}` produisent
 * la même clé), mais PAS à l'ordre des tableaux : `{v:[1,2]}` et `{v:[2,1]}`
 * diffèrent, parce qu'un ordre de tableau est une donnée du lancement
 * (séquence, polygone), pas un artefact de sérialisation.
 *
 * Aucune dépendance ajoutée : sérialisation JSON native après un tri récursif
 * des clés d'objet.
 *
 * ── Préconditions, explicitées le 2026-09-13 (relecture de la tâche 11) ────
 * La signature accepte `Record<string, unknown>`, mais la fonction ne promet
 * un résultat juste que sur des valeurs JSON pures — ce que sont les
 * paramètres d'un lancement, qui viennent tous d'un corps de requête déjà
 * parsé. Sur le reste, elle serait silencieusement fausse plutôt que fausse
 * bruyamment, ce qui est pire ici : la clé sert à reconnaître un rejeu à
 * l'identique, et une COLLISION ferait passer deux lancements différents pour
 * le même.
 *   - `Date` : `Object.keys()` d'une date rend `[]`, donc deux dates
 *     différentes produiraient la MÊME clé. Converties en ISO — dans
 *     `trierClesRecursivement`, seul endroit où c'est possible.
 *   - `undefined`, `NaN`, `Infinity` : `JSON.stringify` les efface ou les
 *     rend `null`, d'où collision. Marqués explicitement.
 *   - cycle, `BigInt` : `JSON.stringify` LÈVE. Attrapé plutôt que de laisser
 *     un 500 remonter d'une fonction de comparaison.
 *
 * **Aucun appelant applicatif à ce jour** : seul son test l'exerce. Les deux
 * moteurs branchés (`/api/analyses/score`, `/api/analyses/correlation`)
 * enregistrent chaque lancement sans chercher de doublon. Le jour où l'un le
 * fera, c'est cette fonction qu'il appellera — d'où ce durcissement plutôt
 * qu'une suppression.
 */
export function cleParametres(parametres: Record<string, unknown>): string {
  try {
    return JSON.stringify(trierClesRecursivement(parametres), (_cle, valeur) => {
      if (valeur === undefined) return '@undefined';
      if (typeof valeur === 'bigint') return `@bigint:${valeur.toString()}`;
      if (typeof valeur === 'number' && !Number.isFinite(valeur)) return `@nonfini:${String(valeur)}`;
      return valeur;
    });
  } catch {
    // Référence circulaire : aucune clé stable n'est calculable. Rendre une
    // chaîne qui ne peut égaler aucune autre vaut mieux que lever — deux
    // lancements incomparables ne doivent surtout pas passer pour identiques.
    return `@incomparable:${Date.now()}:${Math.random()}`;
  }
}

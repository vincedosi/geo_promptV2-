/**
 * lib/chat/tools/indicateursTerritoires.ts
 * Catalogue des indicateurs proposables à l'outil `classement_territoires`.
 *
 * Règle CLAUDE.md : les colonnes de la table `iris` (et de ses paliers agrégés
 * `iris_agg_commune` / `iris_agg_departement`, sql/138) sont DYNAMIQUES — la
 * liste ne doit JAMAIS être un tableau tapé en dur. Elle est donc lue depuis
 * `get_iris_metric_columns()` (information_schema, sql/047), qui existe déjà
 * et sert la même famille de garde-fous ailleurs dans l'app.
 *
 * Vérifié le 2026-09-12 : les 39 colonnes numériques que rend cette RPC sur la
 * table `iris` sont exactement un sous-ensemble des colonnes numériques de
 * `iris_agg_commune` / `iris_agg_departement` (qui en comptent 43 : les 39 +
 * `nb_iris` et `superficie_km2`, deux colonnes de construction de l'agrégat,
 * pas des indicateurs socio-démo). Aucune des 39 n'est donc jamais rejetée par
 * `classer_territoires` (sql/150) — la RPC reste malgré tout la seule autorité
 * qui tranche : cette liste n'est qu'une aide à la découverte, jamais un
 * remplacement de sa validation.
 *
 * Les libellés FR ne viennent PAS de la base (la RPC `get_iris_metric_columns`
 * ne renvoie que des clés, par design — sql/047) : ils viennent du dictionnaire
 * `IRIS_DB_COLUMNS`, déjà la source unique des labels IRIS ailleurs dans l'app
 * (`lib/chat/tools/analyseComplete.ts`). Une clé sans label connu retombe sur
 * la clé elle-même — jamais un label inventé.
 */

import { createAdminClient } from '@/lib/auth';
import { IRIS_DB_COLUMNS }   from '@/lib/iris-crawler/db-columns';

export interface IndicateurClassement {
  key:   string;
  label: string;
}

const IRIS_LABELS: Record<string, string> = Object.fromEntries(
  IRIS_DB_COLUMNS.map(c => [c.name, c.label]),
);

let cache: IndicateurClassement[] | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 300_000; // 5 min — même politique que lib/poi/categories.ts

/**
 * Liste les indicateurs numériques proposables (clé + libellé FR), triés par
 * libellé. Retourne le dernier résultat connu (ou `[]`) si la RPC échoue —
 * jamais de throw : cette liste n'est qu'une aide, pas un chemin critique.
 */
export async function listerIndicateursClassement(): Promise<IndicateurClassement[]> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('get_iris_metric_columns');

  if (error || !data) {
    console.error('[chat/indicateursTerritoires] get_iris_metric_columns error:', error?.message);
    return cache ?? [];
  }

  const liste = (data as { key: string }[])
    .map(({ key }) => ({ key, label: IRIS_LABELS[key] ?? key }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  cache = liste;
  cacheAt = now;
  return liste;
}

/** Force le rafraîchissement au prochain appel (tests). */
export function invalidateIndicateursClassementCache(): void {
  cache = null;
  cacheAt = 0;
}

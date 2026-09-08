/**
 * @file lib/supabase/rpc-json.ts — lecture typée des RPC qui renvoient du jsonb
 *
 * Le générateur de types Supabase type le retour d'une fonction `RETURNS jsonb`
 * par `Json`, une union (`string | number | boolean | Json[] | {…}`) trop large
 * pour un accès direct par propriété : `data.error` ne compile pas.
 *
 * `rpcJson` restreint ce retour à la forme que l'appelant attend. C'est une
 * assertion, pas une validation — elle ne vérifie rien à l'exécution. Elle est
 * justifiée ici parce que la forme est fixée par la fonction SQL elle-même,
 * versionnée dans `sql/`, et non par une entrée utilisateur.
 *
 * À NE PAS utiliser pour des données non maîtrisées (payload de requête, API
 * tierce) : là, il faut un parse Zod.
 *
 * @example
 *   const { data, error } = await supabase.rpc('get_campaign_suivi', {…});
 *   const payload = rpcJson<{ error?: string; pacing?: number }>(data);
 *   if (payload?.error === 'no_strategy') { … }
 */
export function rpcJson<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}

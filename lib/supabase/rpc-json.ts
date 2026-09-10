import type { Json } from '@/types/database.types';

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

/**
 * Convertit une valeur applicative en valeur `jsonb`.
 *
 * `Json` est une union récursive (`string | number | boolean | Json[] | {…}`).
 * Un objet TS ordinaire — `Record<string, unknown>`, une interface métier — ne
 * lui est pas assignable structurellement, même quand il est parfaitement
 * sérialisable. Ce helper fait le pont en un seul endroit documenté plutôt
 * qu'en trente casts dispersés.
 *
 * Précondition : la valeur doit être sérialisable en JSON. Pas de `Date`, pas
 * de `Map`, pas de `undefined` en profondeur, pas de référence circulaire —
 * PostgREST les rejetterait ou les perdrait silencieusement.
 *
 * @example
 *   await supabase.from('custom_geo_zones').insert({ metadata: toJson(meta) });
 */
export function toJson<T>(value: T): Json {
  return value as unknown as Json;
}

/**
 * Passe `null` à un argument de RPC que les types générés déclarent
 * non-nullable.
 *
 * Un paramètre SQL `p_description text` accepte `NULL` — c'est le corps de la
 * fonction qui décide s'il le tolère. Le générateur, lui, mappe `text` vers
 * `string` sans jamais produire `string | null` : il n'a pas l'information.
 * Ce helper marque explicitement les appels où l'on sait que la fonction
 * accepte `NULL`, au lieu d'un `as string` muet qui ressemble à une erreur.
 *
 * Précondition : avoir vérifié que la fonction SQL gère le `NULL` (signature
 * dans `sql/`, ou comportement déjà éprouvé en production).
 *
 * @example
 *   await supabase.rpc('create_custom_geo_zone', {
 *     p_description: nullableArg(parsed.data.description),  // text, NULL accepté
 *   });
 */
export function nullableArg<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

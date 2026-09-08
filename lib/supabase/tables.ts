/**
 * @file lib/supabase/tables.ts — raccourcis vers les types générés de la base
 *
 * Évite de redéclarer à la main la forme des lignes : ces alias pointent vers
 * `types/database.types.ts`, régénéré depuis Supabase. Un type maison finit
 * toujours par diverger du schéma — ces alias, non.
 *
 * @example
 *   const rows: TableInsert<'dsp_campaign_data'>[] = parsed.map(…);
 *   await supabase.from('dsp_campaign_data').insert(rows);
 *
 * @see ARCHITECTURE.md — régénérer après chaque `apply_migration`.
 */
import type { Database } from '@/types/database.types';

type Public = Database['public'];

/** Nom de table valide (autocomplété, refusé s'il n'existe pas en base). */
export type TableName = keyof Public['Tables'];

/** Forme d'une ligne lue. */
export type TableRow<T extends TableName> = Public['Tables'][T]['Row'];

/** Forme acceptée par `.insert()` — colonnes à défaut rendues optionnelles. */
export type TableInsert<T extends TableName> = Public['Tables'][T]['Insert'];

/** Forme acceptée par `.update()` — toutes colonnes optionnelles. */
export type TableUpdate<T extends TableName> = Public['Tables'][T]['Update'];

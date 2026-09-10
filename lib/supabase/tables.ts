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

/**
 * Insert dans une table dont une ou plusieurs colonnes sont remplies par un
 * trigger `BEFORE INSERT`, et que l'appelant ne doit donc PAS fournir.
 *
 * Le générateur de types marque toute colonne `NOT NULL` sans `DEFAULT` comme
 * requise à l'insert — il ne voit pas les triggers. Sur `poi_france`,
 * `trg_poi_france_auto_geom` dérive `geom` de `lat`/`lng` : la colonne est
 * requise pour le générateur, interdite pour l'appelant.
 *
 * Toutes les AUTRES colonnes restent vérifiées : seul le sous-ensemble nommé
 * en `K` est exempté. Préférer ce helper à un cast large, qui ferait aussi
 * sauter la vérification des colonnes légitimes.
 *
 * @example
 *   const row = triggerFilled<'poi_france', 'geom'>({ id, lat, lng, categorie });
 *   await supabase.from('poi_france').upsert(row);
 */
export function triggerFilled<T extends TableName, K extends keyof TableInsert<T>>(
  row: Omit<TableInsert<T>, K>,
): TableInsert<T> {
  return row as TableInsert<T>;
}

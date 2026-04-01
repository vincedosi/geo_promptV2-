/**
 * Radio enrichment pipeline — seeds catalog + runs 4-pass matcher
 *
 * Replaces the old 28-radio static approach with a comprehensive
 * catalog of ~70 radios + exploitant mapping + 4-pass matching.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { matchRadios, type MatchResult } from './radio-matcher';

type ProgressCallback = (event: Record<string, unknown>) => void;

export async function crawlAndMatchRadios(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
  importLogId: string,
): Promise<MatchResult> {
  const logger = new ImportLogger(supabase, importLogId, onProgress);
  await logger.info('INIT', 'Début de l\'enrichissement radios (catalogue complet + matching 4 passes)');

  const result = await matchRadios(supabase, logger);

  return result;
}

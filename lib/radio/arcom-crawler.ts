/**
 * Radio enrichment pipeline — crawl + matching (includes parent detection)
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
  await logger.info('INIT', 'Enrichissement radios : crawl freq-radio + Arcom préfectures + parents + matching');

  const result = await matchRadios(supabase, logger);

  await logger.success('COMPLETE', `Enrichissement terminé : ${result.total_matched}/${result.total_emetteurs} émetteurs matchés (${result.pct_matching}%)`);
  return result;
}

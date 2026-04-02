/**
 * Radio enrichment pipeline — crawl + parent detection + matching
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { matchRadios, type MatchResult } from './radio-matcher';
import { detectParentRadios } from './parent-detector';

type ProgressCallback = (event: Record<string, unknown>) => void;

export async function crawlAndMatchRadios(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
  importLogId: string,
): Promise<MatchResult & { parents_detected: number }> {
  const logger = new ImportLogger(supabase, importLogId, onProgress);
  await logger.info('INIT', 'Enrichissement radios : crawl + détection parents + matching');

  // Step 1: Run the main matching pipeline (crawl + match)
  const matchResult = await matchRadios(supabase, logger);

  // Step 2: Detect parent radios for unmatched local variants
  const parentResult = await logger.phase('PARENT_DETECT', async () => {
    return await detectParentRadios(supabase, logger);
  });

  await logger.success('COMPLETE', `Enrichissement terminé : ${matchResult.total_matched}/${matchResult.total_emetteurs} émetteurs matchés, ${parentResult.detected} parents détectés, ${parentResult.independent} indépendantes`);

  return { ...matchResult, parents_detected: parentResult.detected };
}

/**
 * Radio Matcher — department-based matching using crawled data from ALL radios
 *
 * Pass 1: For departments covered by crawl → assign to crawled radios (proportional)
 * Pass 2: For uncovered departments → assign to national radios (D/E/P with most frequencies)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { crawlAllDepartments, type DeptCrawlEntry } from './dept-crawler';

export interface MatchResult {
  total_emetteurs: number;
  matched_pass1: number;
  matched_pass2: number;
  total_matched: number;
  orphelins: number;
  pct_matching: number;
  crawled_radios: number;
  crawled_frequencies: number;
  depts_covered: number;
}

export async function matchRadios(
  supabase: SupabaseClient,
  logger: ImportLogger,
): Promise<MatchResult> {
  const result: MatchResult = {
    total_emetteurs: 0, matched_pass1: 0, matched_pass2: 0,
    total_matched: 0, orphelins: 0, pct_matching: 0,
    crawled_radios: 0, crawled_frequencies: 0, depts_covered: 0,
  };

  // ── Step 0: Reset ─────────────────────────────────────────────────────────
  await logger.phase('RESET', async () => {
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('id', 'is', null);
    await logger.info('RESET', 'Tous les radio_id remis à NULL');
  });

  // ── Step 1: Crawl ALL radios by auto-generated slug ───────────────────────
  const crawledEntries = await logger.phase('CRAWL', async () => {
    return await crawlAllDepartments(supabase, logger);
  });
  result.crawled_frequencies = crawledEntries.length;
  result.crawled_radios = new Set(crawledEntries.map(e => e.radio_id)).size;

  // Build dept → radio_ids index
  const deptRadioIds = new Map<string, Set<string>>();
  for (const e of crawledEntries) {
    if (!deptRadioIds.has(e.departement)) deptRadioIds.set(e.departement, new Set());
    deptRadioIds.get(e.departement)!.add(e.radio_id);
  }
  result.depts_covered = deptRadioIds.size;
  await logger.info('INDEX', `${deptRadioIds.size} départements couverts, ${result.crawled_radios} radios crawlées`);

  // Get national radio IDs for fallback
  const { data: nationalRadios } = await supabase
    .from('radios')
    .select('id, nom, categorie_arcom, portee, metadata')
    .in('categorie_arcom', ['D', 'E', 'P'])
    .limit(1000);

  const nationalIds = (nationalRadios ?? [])
    .filter(r => {
      const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
      return Array.isArray(freqs) && freqs.length >= 20;
    })
    .map(r => r.id);
  await logger.info('INDEX', `${nationalIds.length} radios nationales pour le fallback`);

  // ── Step 2: Load ALL emitters ─────────────────────────────────────────────
  const emetteurs: Array<{ id: string; departement: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('emetteurs_radio')
      .select('id, departement')
      .range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    emetteurs.push(...data);
    if (data.length < 5000) break;
    offset += 5000;
  }
  result.total_emetteurs = emetteurs.length;
  await logger.info('LOAD', `${emetteurs.length} émetteurs chargés`);

  // Group by department
  const byDept = new Map<string, string[]>();
  for (const em of emetteurs) {
    const d = em.departement ?? '';
    if (!d) continue;
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d)!.push(em.id);
  }

  // ── PASS 1: Crawled departments ───────────────────────────────────────────
  await logger.phase('PASS_1', async () => {
    let matched = 0;
    let deptsDone = 0;

    for (const [dept, emitterIds] of byDept) {
      const radioIds = deptRadioIds.get(dept);
      if (!radioIds || radioIds.size === 0) continue;

      const rids = [...radioIds];

      // Round-robin: assign emitters to radios proportionally
      for (let i = 0; i < emitterIds.length; i += 3) {
        const chunk = emitterIds.slice(i, i + 3);
        await Promise.all(chunk.map((eid, j) =>
          supabase.from('emetteurs_radio')
            .update({ radio_id: rids[(i + j) % rids.length] })
            .eq('id', eid)
        ));
        matched += chunk.length;
      }

      deptsDone++;
      if (deptsDone % 10 === 0) {
        await logger.info('PASS_1', `${deptsDone}/${byDept.size} depts, ${matched}/${result.total_emetteurs} (${(matched / result.total_emetteurs * 100).toFixed(1)}%)`);
      }
    }

    result.matched_pass1 = matched;
    await logger.info('PASS_1', `Passe 1 terminée : ${matched} matchés (${(matched / result.total_emetteurs * 100).toFixed(1)}%)`);
  });

  // ── PASS 2: Fallback — uncovered departments → nationals ──────────────────
  await logger.phase('PASS_2', async () => {
    if (nationalIds.length === 0) {
      await logger.warn('PASS_2', 'Aucune radio nationale pour le fallback');
      return;
    }

    let orphanIds: string[] = [];
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from('emetteurs_radio')
        .select('id')
        .is('radio_id', null)
        .range(off, off + 4999);
      if (!data || data.length === 0) break;
      orphanIds.push(...data.map(d => d.id));
      if (data.length < 5000) break;
      off += 5000;
    }

    if (orphanIds.length === 0) {
      await logger.info('PASS_2', 'Aucun orphelin restant');
      return;
    }

    let matched = 0;
    for (let i = 0; i < orphanIds.length; i += 3) {
      const chunk = orphanIds.slice(i, i + 3);
      await Promise.all(chunk.map((eid, j) =>
        supabase.from('emetteurs_radio')
          .update({ radio_id: nationalIds[(i + j) % nationalIds.length] })
          .eq('id', eid)
      ));
      matched += chunk.length;
    }

    result.matched_pass2 = matched;
    await logger.info('PASS_2', `Passe 2 (fallback nationaux) : +${matched} (total ${((result.matched_pass1 + matched) / result.total_emetteurs * 100).toFixed(1)}%)`);
  });

  // ── Final stats ───────────────────────────────────────────────────────────
  result.total_matched = result.matched_pass1 + result.matched_pass2;
  result.orphelins = result.total_emetteurs - result.total_matched;
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2}, ${result.depts_covered} depts couverts, ${result.crawled_radios} radios crawlées`);
  return result;
}

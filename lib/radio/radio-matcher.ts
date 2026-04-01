/**
 * Radio Matcher — department-based matching using crawled + ODS data
 *
 * Pass 1: For departments covered by crawl data, assign emitters
 *         round-robin to radios known to broadcast there
 * Pass 2: For remaining departments, assign to national radios
 *         (E/P/D categories with 50+ frequencies)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { crawlAllRadioFrequencies } from './freq-radio-crawler';

export interface MatchResult {
  total_emetteurs: number;
  matched_pass1: number;
  matched_pass2: number;
  total_matched: number;
  orphelins: number;
  pct_matching: number;
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
    crawled_frequencies: 0, depts_covered: 0,
  };

  // ── Step 0: Reset all radio_id ────────────────────────────────────────────
  await logger.phase('RESET', async () => {
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('id', 'is', null);
    await logger.info('RESET', 'Tous les radio_id remis à NULL');
  });

  // ── Step 1: Load radios ───────────────────────────────────────────────────
  const { data: allRadios } = await supabase.from('radios').select('id, nom, categorie_arcom, portee, metadata').limit(100000);
  const radioById = new Map<string, { nom: string; categorie_arcom: string | null; portee: string | null; nb_freq_fm: number }>();
  const radioByName = new Map<string, string>();
  for (const r of allRadios ?? []) {
    const freqsFm = (r.metadata as Record<string, unknown>)?.frequences_fm;
    const nbFreq = Array.isArray(freqsFm) ? freqsFm.length : 0;
    radioById.set(r.id, { nom: r.nom, categorie_arcom: r.categorie_arcom, portee: r.portee, nb_freq_fm: nbFreq });
    radioByName.set(r.nom.toUpperCase(), r.id);
  }
  await logger.info('LOAD', `${radioById.size} radios en base`);

  // ── Step 2: Crawl frequence-radio.com for dept→radios mapping ─────────────
  const crawledFreqs = await logger.phase('CRAWL', async () => {
    return await crawlAllRadioFrequencies(logger);
  });
  result.crawled_frequencies = crawledFreqs.length;

  // Build dept→radio names index
  const deptRadioNames = new Map<string, Set<string>>();
  for (const cf of crawledFreqs) {
    if (!deptRadioNames.has(cf.departement)) deptRadioNames.set(cf.departement, new Set());
    deptRadioNames.get(cf.departement)!.add(cf.radio_nom);
  }
  result.depts_covered = deptRadioNames.size;
  await logger.info('INDEX', `${deptRadioNames.size} départements couverts par le crawl, ${crawledFreqs.length} fréquences`);

  // Get national radio IDs (for pass 2 fallback)
  const nationalRadioIds: string[] = [];
  for (const [id, r] of radioById) {
    if (r.nb_freq_fm >= 30 || r.portee === 'nationale' || ['E', 'P'].includes(r.categorie_arcom ?? '')) {
      nationalRadioIds.push(id);
    }
  }
  await logger.info('INDEX', `${nationalRadioIds.length} radios nationales identifiées pour le fallback`);

  // ── Step 3: Load ALL emitters with pagination ─────────────────────────────
  interface Emitter { id: string; departement: string | null }
  const emetteurs: Emitter[] = [];
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

  // ── PASS 1: Dept→crawled radios assignment ────────────────────────────────
  await logger.phase('PASS_1', async () => {
    let matched = 0;
    let deptsDone = 0;

    for (const [dept, emitterIds] of byDept) {
      const radioNames = deptRadioNames.get(dept);
      if (!radioNames || radioNames.size === 0) continue;

      // Resolve radio IDs
      const radioIds: string[] = [];
      for (const rnom of radioNames) {
        const rid = radioByName.get(rnom.toUpperCase());
        if (rid) radioIds.push(rid);
      }
      if (radioIds.length === 0) continue;

      // Round-robin assignment
      for (let i = 0; i < emitterIds.length; i += 200) {
        const batch = emitterIds.slice(i, i + 200);
        // Assign each emitter to a radio in round-robin
        const updates = batch.map((eid, j) => ({
          id: eid,
          radio_id: radioIds[(i + j) % radioIds.length],
        }));

        // Execute updates (max 3 concurrent per CLAUDE.md)
        for (let k = 0; k < updates.length; k += 3) {
          const chunk = updates.slice(k, k + 3);
          await Promise.all(chunk.map(u =>
            supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id)
          ));
        }
        matched += batch.length;
      }

      deptsDone++;
      if (deptsDone % 10 === 0) {
        await logger.info('PASS_1', `${deptsDone}/${byDept.size} depts, ${matched}/${result.total_emetteurs} matchés (${(matched / result.total_emetteurs * 100).toFixed(1)}%)`);
      }
    }

    result.matched_pass1 = matched;
    await logger.info('PASS_1', `Passe 1 terminée : ${matched} matchés (${(matched / result.total_emetteurs * 100).toFixed(1)}%)`);
  });

  // ── PASS 2: Fallback — assign remaining to nationals ──────────────────────
  await logger.phase('PASS_2', async () => {
    if (nationalRadioIds.length === 0) {
      await logger.warn('PASS_2', 'Aucune radio nationale pour le fallback');
      return;
    }

    // Reload orphans
    const orphanIds: string[] = [];
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
    for (let i = 0; i < orphanIds.length; i += 200) {
      const batch = orphanIds.slice(i, i + 200);
      const updates = batch.map((eid, j) => ({
        id: eid,
        radio_id: nationalRadioIds[(i + j) % nationalRadioIds.length],
      }));
      for (let k = 0; k < updates.length; k += 3) {
        const chunk = updates.slice(k, k + 3);
        await Promise.all(chunk.map(u =>
          supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id)
        ));
      }
      matched += batch.length;
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

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2}, ${result.depts_covered} depts couverts`);
  return result;
}

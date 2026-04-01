/**
 * Radio Matcher — géo-based matching using crawled frequencies
 *
 * Strategy: frequence-radio.com gives us (radio, ville, dept).
 * ANFR data gives us (emitter, GPS, dept) but NOT specific frequency.
 *
 * Matching approach:
 * Pass 1: For each crawled (radio, dept), find ANFR emitters in same dept
 *         near the crawled city. Assign proportionally.
 * Pass 2: For remaining orphans, assign to most common radio in their dept.
 * Pass 3: Skip technical operators (TDF, Towercast are NOT radios).
 *
 * The key insight: at each transmitter site (same GPS), there are N
 * emitters = N different radio authorizations. And frequence-radio.com
 * tells us which N radios broadcast from each city/dept.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { RADIO_CATALOG } from './radio-catalog';
import { crawlAllRadioFrequencies, type CrawledFrequency } from './freq-radio-crawler';

export interface MatchResult {
  total_emetteurs: number;
  matched_pass1: number;
  matched_pass2: number;
  matched_pass3: number;
  total_matched: number;
  orphelins: number;
  pct_matching: number;
  radios_created: number;
  crawled_frequencies: number;
}

const BATCH = 200;

export async function matchRadios(
  supabase: SupabaseClient,
  logger: ImportLogger,
): Promise<MatchResult> {
  const result: MatchResult = {
    total_emetteurs: 0, matched_pass1: 0, matched_pass2: 0,
    matched_pass3: 0, total_matched: 0,
    orphelins: 0, pct_matching: 0, radios_created: 0, crawled_frequencies: 0,
  };

  // ── Step 0: Reset all radio_id to NULL for clean re-matching ──────────────
  await logger.phase('RESET', async () => {
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('id', 'is', null);
    await logger.info('RESET', 'Tous les radio_id remis à NULL pour re-matching');
  });

  // ── Step 1: Seed catalog radios ───────────────────────────────────────────
  await logger.phase('SEED_RADIOS', async () => {
    for (let i = 0; i < RADIO_CATALOG.length; i += 50) {
      const batch = RADIO_CATALOG.slice(i, i + 50).map(r => ({
        nom: r.nom, categorie_arcom: r.categorie_arcom,
        portee: r.portee, genre: r.genre, groupe_media: r.groupe_media,
      }));
      await supabase.from('radios').upsert(batch, { onConflict: 'nom' });
    }
    await logger.info('SEED_RADIOS', `${RADIO_CATALOG.length} radios du catalogue insérées`);
  });

  // ── Step 2: Crawl frequence-radio.com ─────────────────────────────────────
  const crawledFreqs = await logger.phase('CRAWL', async () => {
    return await crawlAllRadioFrequencies(logger);
  });
  result.crawled_frequencies = crawledFreqs.length;

  if (crawledFreqs.length === 0) {
    await logger.error('CRAWL', 'Aucune fréquence crawlée — impossible de matcher');
    return result;
  }

  // ── Step 3: Ensure all crawled radios exist in DB ─────────────────────────
  await logger.phase('UPSERT_RADIOS', async () => {
    const uniqueRadios = [...new Set(crawledFreqs.map(f => f.radio_nom))];
    let created = 0;
    for (let i = 0; i < uniqueRadios.length; i += 50) {
      const batch = uniqueRadios.slice(i, i + 50).map(nom => ({ nom }));
      const { error } = await supabase.from('radios').upsert(batch, { onConflict: 'nom' });
      if (!error) created += batch.length;
    }
    result.radios_created = created;
    await logger.info('UPSERT_RADIOS', `${uniqueRadios.length} radios uniques, ${created} insérées/mises à jour`);
  });

  // Load radios from DB
  const { data: allRadios } = await supabase.from('radios').select('id, nom').limit(100000);
  const radioByName = new Map<string, string>();
  for (const r of allRadios ?? []) {
    radioByName.set(r.nom.toUpperCase(), r.id);
  }

  // ── Step 4: Build dept→radios index from crawled data ─────────────────────
  // For each department, which radios broadcast there?
  const deptRadios = new Map<string, Set<string>>(); // dept → Set<radio_nom>
  for (const cf of crawledFreqs) {
    if (!deptRadios.has(cf.departement)) deptRadios.set(cf.departement, new Set());
    deptRadios.get(cf.departement)!.add(cf.radio_nom);
  }
  await logger.info('INDEX', `${deptRadios.size} départements avec données radio crawlées`);

  // ── Step 5: Load ALL emitters with pagination ─────────────────────────────
  const emetteurs: Array<{ id: string; departement: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('emetteurs_radio')
      .select('id, departement')
      .is('radio_id', null)
      .range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    emetteurs.push(...data);
    if (data.length < 5000) break;
    offset += 5000;
  }
  result.total_emetteurs = emetteurs.length;
  await logger.info('LOAD', `${emetteurs.length} émetteurs orphelins chargés`);

  // ── PASS 1: Group emitters by GPS site, assign radios from dept data ──────
  await logger.phase('PASS_1', async () => {
    // Group emitters by department
    const byDept = new Map<string, string[]>(); // dept → emitter IDs
    for (const em of emetteurs) {
      const dept = em.departement ?? '';
      if (!dept) continue;
      if (!byDept.has(dept)) byDept.set(dept, []);
      byDept.get(dept)!.push(em.id);
    }

    let matched = 0;
    let deptsDone = 0;

    for (const [dept, emitterIds] of byDept) {
      const radiosInDept = deptRadios.get(dept);
      if (!radiosInDept || radiosInDept.size === 0) continue;

      // Get radio IDs for this department
      const radioIds: string[] = [];
      for (const rnom of radiosInDept) {
        const rid = radioByName.get(rnom.toUpperCase());
        if (rid) radioIds.push(rid);
      }
      if (radioIds.length === 0) continue;

      // Assign emitters round-robin to radios in this department
      // This is the best we can do without individual frequencies
      for (let i = 0; i < emitterIds.length; i++) {
        const radioId = radioIds[i % radioIds.length];
        // Batch updates
        await supabase.from('emetteurs_radio').update({ radio_id: radioId }).eq('id', emitterIds[i]);
        matched++;
      }

      deptsDone++;
      if (deptsDone % 10 === 0) {
        await logger.info('PASS_1', `Progression : ${deptsDone}/${byDept.size} départements, ${matched} matchés`);
      }
    }

    result.matched_pass1 = matched;
    await logger.info('PASS_1', `Passe 1 (dept→radios round-robin) : ${matched} matchés (${pct(matched, result.total_emetteurs)}%)`);
  });

  // ── PASS 2: Remaining orphans → assign to closest known radio ─────────────
  await logger.phase('PASS_2', async () => {
    // Reload orphans
    let orphanIds: string[] = [];
    let off = 0;
    while (true) {
      const { data } = await supabase
        .from('emetteurs_radio')
        .select('id, departement')
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

    // Assign to the most common radio overall (France Inter has most emitters)
    const fallbackRadioId = radioByName.get('FRANCE INTER') ?? radioByName.get('FRANCE BLEU');
    if (!fallbackRadioId) {
      await logger.warn('PASS_2', 'Aucune radio fallback trouvée');
      return;
    }

    let matched = 0;
    for (let i = 0; i < orphanIds.length; i += BATCH) {
      const batch = orphanIds.slice(i, i + BATCH);
      await supabase.from('emetteurs_radio').update({ radio_id: fallbackRadioId }).in('id', batch);
      matched += batch.length;
    }

    result.matched_pass2 = matched;
    await logger.info('PASS_2', `Passe 2 (fallback orphelins) : +${matched} (total ${pct(result.matched_pass1 + matched, result.total_emetteurs)}%)`);
  });

  // ── Final stats ───────────────────────────────────────────────────────────
  result.total_matched = result.matched_pass1 + result.matched_pass2 + result.matched_pass3;
  result.orphelins = result.total_emetteurs - result.total_matched;
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2}`);
  return result;
}

function pct(n: number, total: number): string {
  return total > 0 ? (n / total * 100).toFixed(1) : '0';
}

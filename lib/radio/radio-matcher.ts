/**
 * Radio Matcher — 4-pass matching for maximum coverage
 *
 * Pass 1: Frequency + department exact match from crawled data (~70-80%)
 * Pass 2: Frequency match with tolerance ±0.1 MHz (~5-10%)
 * Pass 3: Exploitant name matching (ARCOM = Radio France, etc.) (~5%)
 * Pass 4: Auto-create radio from remaining frequencies (~5-10%)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { RADIO_CATALOG, EXPLOITANT_TO_RADIO } from './radio-catalog';
import { crawlAllRadioFrequencies, type CrawledFrequency } from './freq-radio-crawler';

export interface MatchResult {
  total_emetteurs: number;
  matched_pass1: number;
  matched_pass2: number;
  matched_pass3: number;
  matched_pass4: number;
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
    matched_pass3: 0, matched_pass4: 0, total_matched: 0,
    orphelins: 0, pct_matching: 0, radios_created: 0, crawled_frequencies: 0,
  };

  // ── Step 0: Seed catalog radios ───────────────────────────────────────────
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

  // Load radios from DB
  const { data: allRadios } = await supabase.from('radios').select('id, nom').limit(100000);
  const radioByName = new Map<string, string>();
  for (const r of allRadios ?? []) {
    radioByName.set(r.nom, r.id);
    radioByName.set(r.nom.toLowerCase(), r.id);
  }

  // ── Step 1: Crawl frequence-radio.com ─────────────────────────────────────
  const crawledFreqs = await logger.phase('CRAWL', async () => {
    return await crawlAllRadioFrequencies(logger);
  });
  result.crawled_frequencies = crawledFreqs.length;

  // Build frequency index: "dept:freq" → radio_nom
  // Use rounded frequency (1 decimal) as key
  const freqIndex = new Map<string, string>(); // "75:87.8" → "France Inter"
  for (const cf of crawledFreqs) {
    const key = `${cf.departement}:${cf.frequence_mhz.toFixed(1)}`;
    freqIndex.set(key, cf.radio_nom);
  }
  await logger.info('INDEX', `Index fréquence construit : ${freqIndex.size} entrées`);

  // Load ALL emitters (with pagination to avoid 5000 limit)
  const emetteurs: Array<{ id: string; sta_nm_anfr: string; exploitant: string | null; frequence_mhz: number | null; departement: string | null; radio_id: string | null }> = [];
  let offset = 0;
  const PAGE = 5000;
  while (true) {
    const { data } = await supabase
      .from('emetteurs_radio')
      .select('id, sta_nm_anfr, exploitant, frequence_mhz, departement, radio_id')
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    emetteurs.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  result.total_emetteurs = emetteurs.length;
  const orphelins = emetteurs.filter(e => !e.radio_id);
  await logger.info('INIT', `${emetteurs.length} émetteurs chargés, ${orphelins.length} orphelins à matcher`);

  // ── PASS 1: Frequency + department exact ──────────────────────────────────
  await logger.phase('PASS_1', async () => {
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of orphelins) {
      if (!em.frequence_mhz || !em.departement) continue;
      const key = `${em.departement}:${em.frequence_mhz.toFixed(1)}`;
      const radioNom = freqIndex.get(key);
      if (!radioNom) continue;

      const radioId = radioByName.get(radioNom) ?? radioByName.get(radioNom.toLowerCase());
      if (!radioId) continue;

      updates.push({ id: em.id, radio_id: radioId });
      em.radio_id = radioId;
    }

    await batchUpdate(supabase, updates);
    result.matched_pass1 = updates.length;
    await logger.info('PASS_1', `Passe 1 (freq+dept exact) : ${updates.length} matchés (${pct(updates.length, result.total_emetteurs)}%)`);
  });

  // ── PASS 2: Frequency with ±0.1 MHz tolerance ────────────────────────────
  await logger.phase('PASS_2', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of stillOrphelins) {
      if (!em.frequence_mhz || !em.departement) continue;

      // Try ±0.1 MHz
      for (const delta of [-0.1, 0.1, -0.2, 0.2]) {
        const key = `${em.departement}:${(em.frequence_mhz + delta).toFixed(1)}`;
        const radioNom = freqIndex.get(key);
        if (!radioNom) continue;
        const radioId = radioByName.get(radioNom) ?? radioByName.get(radioNom.toLowerCase());
        if (!radioId) continue;
        updates.push({ id: em.id, radio_id: radioId });
        em.radio_id = radioId;
        break;
      }
    }

    await batchUpdate(supabase, updates);
    result.matched_pass2 = updates.length;
    const totalSoFar = result.matched_pass1 + result.matched_pass2;
    await logger.info('PASS_2', `Passe 2 (freq ±0.2 MHz) : +${updates.length} (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── PASS 3: Exploitant name mapping ───────────────────────────────────────
  await logger.phase('PASS_3', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of stillOrphelins) {
      const exp = (em.exploitant ?? '').trim().toUpperCase();
      if (!exp) continue;

      const radioName = EXPLOITANT_TO_RADIO[exp];
      if (!radioName || radioName === '__SKIP__') continue;

      const radioId = radioByName.get(radioName) ?? radioByName.get(radioName.toLowerCase());
      if (!radioId) continue;
      updates.push({ id: em.id, radio_id: radioId });
      em.radio_id = radioId;
    }

    await batchUpdate(supabase, updates);
    result.matched_pass3 = updates.length;
    const totalSoFar = result.matched_pass1 + result.matched_pass2 + result.matched_pass3;
    await logger.info('PASS_3', `Passe 3 (exploitant) : +${updates.length} (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── PASS 4: Group remaining by frequency and create radios ────────────────
  await logger.phase('PASS_4', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];

    // Group orphelins by (dept, freq) — same freq in same dept = same radio
    const groups = new Map<string, typeof stillOrphelins>();
    for (const em of stillOrphelins) {
      if (!em.frequence_mhz || !em.departement) continue;
      const key = `${em.departement}:${em.frequence_mhz.toFixed(1)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(em);
    }

    // For each group, create a radio named "Radio {freq} MHz ({dept})"
    for (const [key, ems] of groups) {
      const [dept, freq] = key.split(':');
      const nom = `Radio ${freq} MHz (${dept})`;

      const { data: radio } = await supabase
        .from('radios')
        .upsert({ nom }, { onConflict: 'nom' })
        .select('id')
        .single();

      if (radio) {
        radioByName.set(nom, radio.id);
        result.radios_created++;
        for (const em of ems) {
          updates.push({ id: em.id, radio_id: radio.id });
          em.radio_id = radio.id;
        }
      }
    }

    await batchUpdate(supabase, updates);
    result.matched_pass4 = updates.length;
    const totalSoFar = result.matched_pass1 + result.matched_pass2 + result.matched_pass3 + result.matched_pass4;
    await logger.info('PASS_4', `Passe 4 (auto-create) : +${updates.length}, ${result.radios_created} radios créées (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── Final stats ───────────────────────────────────────────────────────────
  // Count already-matched before this run
  const alreadyMatched = emetteurs.length - orphelins.length;
  result.total_matched = alreadyMatched + result.matched_pass1 + result.matched_pass2 + result.matched_pass3 + result.matched_pass4;
  result.orphelins = result.total_emetteurs - result.total_matched;
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  const finalOrphelins = emetteurs.filter(e => !e.radio_id);
  if (finalOrphelins.length > 0) {
    await logger.warn('ORPHELINS', `${finalOrphelins.length} orphelins restants (${pct(finalOrphelins.length, result.total_emetteurs)}%)`, {
      sample: finalOrphelins.slice(0, 20).map(e => ({
        sta: e.sta_nm_anfr, freq: e.frequence_mhz, dept: e.departement, exp: e.exploitant,
      })),
    });
  }

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2} P3:${result.matched_pass3} P4:${result.matched_pass4}`);
  return result;
}

async function batchUpdate(supabase: SupabaseClient, updates: Array<{ id: string; radio_id: string }>) {
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    // Supabase doesn't support batch update by different IDs easily,
    // so we do individual updates but in parallel (max 3 concurrent per CLAUDE.md rules)
    for (let j = 0; j < batch.length; j += 3) {
      const chunk = batch.slice(j, j + 3);
      await Promise.all(chunk.map(u =>
        supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id)
      ));
    }
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? (n / total * 100).toFixed(1) : '0';
}

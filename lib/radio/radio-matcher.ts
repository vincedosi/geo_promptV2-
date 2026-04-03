/**
 * Radio Matcher — department-based matching
 *
 * Pipeline order (CRITICAL):
 * 1. RESET all radio_id
 * 2. CRAWL frequence-radio.com → build dept→radio index
 * 3. CRAWL Arcom 100 prefectures → ENRICH the same index
 * 4. PARENT DETECT (while radios still have 0 emitters)
 * 5. PASS 1: match with MERGED index (freq-radio + Arcom)
 * 6. PASS 2: fallback nationals for uncovered depts
 * 7. RAPPORT: comprehensive matching audit log
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { crawlAllDepartments } from './dept-crawler';
import { crawlArcomPrefectures, enrichDeptIndexFromArcom, type ArcomRadioEntry } from './arcom-prefectures';
import { detectParentRadios } from './parent-detector';

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

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0: RESET
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('RESET', async () => {
    await supabase.from('emetteurs_radio').update({ radio_id: null }).not('id', 'is', null);
    await logger.info('RESET', 'Tous les radio_id remis à NULL');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1: CRAWL frequence-radio.com → build dept→radio index
  // ══════════════════════════════════════════════════════════════════════════
  const deptRadioIds = new Map<string, Set<string>>();

  const crawledEntries = await logger.phase('CRAWL_FREQ', async () => {
    return await crawlAllDepartments(supabase, logger);
  });
  result.crawled_frequencies = crawledEntries.length;
  result.crawled_radios = new Set(crawledEntries.map(e => e.radio_id)).size;

  for (const e of crawledEntries) {
    if (!deptRadioIds.has(e.departement)) deptRadioIds.set(e.departement, new Set());
    deptRadioIds.get(e.departement)!.add(e.radio_id);
  }

  await logger.info('INDEX', `Après freq-radio : ${deptRadioIds.size} depts, ${result.crawled_radios} radios`);

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2: CRAWL Arcom prefectures → ENRICH the SAME index
  // ══════════════════════════════════════════════════════════════════════════
  let arcomEntriesForReport: ArcomRadioEntry[] = [];
  await logger.phase('CRAWL_ARCOM', async () => {
    const arcomEntries = await crawlArcomPrefectures(supabase, logger);
    arcomEntriesForReport = arcomEntries;
    const enriched = await enrichDeptIndexFromArcom(supabase, logger, arcomEntries, deptRadioIds);
    await logger.info('INDEX', `Après Arcom : ${deptRadioIds.size} depts (+${enriched} nouvelles entrées dept→radio)`);
  });

  result.depts_covered = deptRadioIds.size;

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3: PARENT DETECT (while radios still have 0 emitters)
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('PARENT_DETECT', async () => {
    await detectParentRadios(supabase, logger);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4: Load emitters + prepare national fallback
  // ══════════════════════════════════════════════════════════════════════════
  const { data: nationalRadios } = await supabase
    .from('radios')
    .select('id, metadata')
    .in('categorie_arcom', ['D', 'E', 'P'])
    .limit(1000);

  const nationalIds = (nationalRadios ?? [])
    .filter(r => {
      const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
      return Array.isArray(freqs) && freqs.length >= 20;
    })
    .map(r => r.id);
  await logger.info('INDEX', `${nationalIds.length} radios nationales pour le fallback`);

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

  // ══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC: Audit merged index before matching (Radio Scoop + dept 69)
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('DIAGNOSTIC', async () => {
    // Load all radios for name resolution
    const { data: allRadiosForDiag } = await supabase.from('radios').select('id, nom, categorie_arcom, metadata').limit(100000);
    const radioNameById = new Map<string, string>();
    const radioCatById = new Map<string, string>();
    const radioFmCountById = new Map<string, number>();
    for (const r of allRadiosForDiag ?? []) {
      radioNameById.set(r.id, r.nom);
      radioCatById.set(r.id, r.categorie_arcom ?? '?');
      const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
      radioFmCountById.set(r.id, Array.isArray(freqs) ? freqs.length : 0);
    }

    // Find Radio Scoop by name (never hardcode partial UUIDs)
    let radioScoopId: string | undefined;
    for (const [id, nom] of radioNameById) {
      if (nom.toLowerCase().trim() === 'radio scoop') { radioScoopId = id; break; }
    }
    if (radioScoopId) {
      await logger.info('DIAGNOSTIC', `Radio Scoop dans DB : id=${radioScoopId}, nom="${radioNameById.get(radioScoopId)}", cat=${radioCatById.get(radioScoopId)}, ${radioFmCountById.get(radioScoopId)} freq FM`);
    } else {
      await logger.error('DIAGNOSTIC', 'Radio Scoop NON TROUVÉE dans la table radios — problème import ODS ?');
    }

    // Check what Arcom returned for dept 69
    const arcom69 = arcomEntriesForReport.filter(e => e.departement === '69');
    const arcom69Names = arcom69.map(e => e.radio_nom);
    const arcomHasScoop = arcom69Names.some(n => n.toLowerCase().includes('scoop'));
    await logger.info('DIAGNOSTIC', `Arcom dept 69 : ${arcom69Names.length} radios — ${arcom69Names.slice(0, 20).join(', ')}${arcom69Names.length > 20 ? '...' : ''}`);
    await logger.info('DIAGNOSTIC', `Arcom dept 69 contient "scoop" ? ${arcomHasScoop ? 'OUI → ' + arcom69Names.filter(n => n.toLowerCase().includes('scoop')).join(', ') : 'NON'}`);

    // Check the exact name variants in Arcom for all depts
    const arcomScoopAll = arcomEntriesForReport.filter(e => e.radio_nom.toLowerCase().includes('scoop'));
    if (arcomScoopAll.length > 0) {
      await logger.info('DIAGNOSTIC', `Arcom "scoop" dans TOUS les depts : ${arcomScoopAll.map(e => `"${e.radio_nom}" (dept ${e.departement})`).join(', ')}`);
    } else {
      await logger.warn('DIAGNOSTIC', 'Arcom ne contient AUCUNE radio avec "scoop" dans le nom — problème parser ?');
    }

    // Log the merged index for dept 69
    const dept69Ids = deptRadioIds.get('69');
    if (dept69Ids && dept69Ids.size > 0) {
      const dept69Names = [...dept69Ids].map(id => `${radioNameById.get(id) ?? id} (${radioCatById.get(id)})`);
      await logger.info('DIAGNOSTIC', `Index fusionné dept 69 : ${dept69Ids.size} radios — ${dept69Names.join(', ')}`);
      if (radioScoopId) {
        const scoopInIndex = dept69Ids.has(radioScoopId);
        if (scoopInIndex) {
          await logger.success('DIAGNOSTIC', `✓ Radio Scoop (${radioScoopId.slice(0, 8)}) EST dans l'index dept 69`);
        } else {
          await logger.error('DIAGNOSTIC', `✗ Radio Scoop (${radioScoopId.slice(0, 8)}) ABSENT de l'index dept 69 → 0 émetteurs garanti`);
          // Check if it's in any dept
          const scoopDepts: string[] = [];
          for (const [d, ids] of deptRadioIds) {
            if (ids.has(radioScoopId)) scoopDepts.push(d);
          }
          if (scoopDepts.length > 0) {
            await logger.warn('DIAGNOSTIC', `Radio Scoop trouvée dans depts : ${scoopDepts.join(', ')} (mais pas 69)`);
          } else {
            await logger.error('DIAGNOSTIC', 'Radio Scoop ABSENTE de TOUT l\'index fusionné — ni freq-radio ni Arcom');
          }
        }
      }
    } else {
      await logger.error('DIAGNOSTIC', 'Dept 69 ABSENT de l\'index fusionné — aucune radio pour Lyon');
    }

    // Check freq-radio crawl results for Radio Scoop
    if (radioScoopId) {
      const freqRadioScoop = crawledEntries.filter(e => e.radio_id === radioScoopId);
      if (freqRadioScoop.length > 0) {
        await logger.info('DIAGNOSTIC', `freq-radio Radio Scoop : ${freqRadioScoop.length} entrées — depts: ${[...new Set(freqRadioScoop.map(e => e.departement))].join(', ')}`);
      } else {
        await logger.warn('DIAGNOSTIC', `freq-radio Radio Scoop : 0 entrées (slug "radio-scoop" probablement 404)`);
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PASS 1: Match with MERGED index (freq-radio + Arcom combined)
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('PASS_1', async () => {
    let matched = 0;
    let deptsDone = 0;

    for (const [dept, emitterIds] of byDept) {
      const radioIds = deptRadioIds.get(dept);
      if (!radioIds || radioIds.size === 0) continue;

      const rids = [...radioIds];
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

  // ══════════════════════════════════════════════════════════════════════════
  // PASS 2: Fallback nationals for uncovered departments
  // ══════════════════════════════════════════════════════════════════════════
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
    await logger.info('PASS_2', `Passe 2 (fallback nationaux) : +${matched}`);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL STATS
  // ══════════════════════════════════════════════════════════════════════════
  result.total_matched = result.matched_pass1 + result.matched_pass2;
  result.orphelins = result.total_emetteurs - result.total_matched;
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2}, ${result.depts_covered} depts, ${result.crawled_radios} radios crawlées`);

  // ══════════════════════════════════════════════════════════════════════════
  // RAPPORT: Comprehensive matching audit log
  // ══════════════════════════════════════════════════════════════════════════
  await logger.phase('RAPPORT', async () => {
    await generateMatchingReport(supabase, logger, result, deptRadioIds, arcomEntriesForReport, crawledEntries);
  });

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// Report generator — exhaustive matching audit
// ════════════════════════════════════════════════════════════════════════════

async function generateMatchingReport(
  supabase: SupabaseClient,
  logger: ImportLogger,
  result: MatchResult,
  deptRadioIds: Map<string, Set<string>>,
  arcomEntries: ArcomRadioEntry[],
  freqRadioEntries: Array<{ radio_id: string; departement: string; radio_nom: string }>,
): Promise<void> {
  // Load all radios with metadata
  const { data: allRadios } = await supabase.from('radios').select('id, nom, categorie_arcom, metadata').limit(100000);
  const radioMap = new Map<string, { nom: string; cat: string; fmCount: number }>();
  for (const r of allRadios ?? []) {
    const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
    radioMap.set(r.id, {
      nom: r.nom,
      cat: r.categorie_arcom ?? '?',
      fmCount: Array.isArray(freqs) ? freqs.length : 0,
    });
  }

  // Count emitters per radio
  const radioEmitterCounts = new Map<string, number>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('emetteurs_radio')
      .select('radio_id')
      .not('radio_id', 'is', null)
      .range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      radioEmitterCounts.set(row.radio_id, (radioEmitterCounts.get(row.radio_id) ?? 0) + 1);
    }
    if (data.length < 5000) break;
    offset += 5000;
  }

  // ── RÉSUMÉ ──────────────────────────────────────────────────────────────
  const sep = '═══════════════════════════════════════════════';
  const sep2 = '───────────────────────────────────────────────';
  await logger.info('RAPPORT', sep);
  await logger.info('RAPPORT', 'RÉSUMÉ MATCHING');
  await logger.info('RAPPORT', sep2);
  await logger.info('RAPPORT', `Total émetteurs : ${result.total_emetteurs}`);
  await logger.info('RAPPORT', `Passe 1 (freq-radio + Arcom) : ${result.matched_pass1} (${(result.matched_pass1 / result.total_emetteurs * 100).toFixed(1)}%)`);
  await logger.info('RAPPORT', `Passe 2 (fallback nationaux) : ${result.matched_pass2} (${(result.matched_pass2 / result.total_emetteurs * 100).toFixed(1)}%)`);
  await logger.info('RAPPORT', `Orphelins : ${result.orphelins}`);
  await logger.info('RAPPORT', `Depts couverts : ${result.depts_covered}`);

  // ── RADIOS MATCHÉES ─────────────────────────────────────────────────────
  await logger.info('RAPPORT', sep2);
  const matchedRadios = [...radioEmitterCounts.entries()]
    .map(([id, count]) => ({ id, count, nom: radioMap.get(id)?.nom ?? id }))
    .sort((a, b) => b.count - a.count);

  await logger.info('RAPPORT', `RADIOS MATCHÉES : ${matchedRadios.length} radios avec émetteurs`);
  const top20 = matchedRadios.slice(0, 20).map(r => `${r.nom} (${r.count})`).join(', ');
  await logger.info('RAPPORT', `Top 20 : ${top20}`);

  // ── RADIOS NON MATCHÉES ─────────────────────────────────────────────────
  await logger.info('RAPPORT', sep2);
  const unmatchedRadios = (allRadios ?? [])
    .filter(r => !radioEmitterCounts.has(r.id))
    .map(r => {
      const freqs = (r.metadata as Record<string, unknown>)?.frequences_fm;
      const fmCount = Array.isArray(freqs) ? freqs.length : 0;
      return { id: r.id, nom: r.nom, cat: r.categorie_arcom ?? '?', fmCount };
    })
    .sort((a, b) => b.fmCount - a.fmCount);

  await logger.info('RAPPORT', `RADIOS NON MATCHÉES : ${unmatchedRadios.length} radios avec 0 émetteurs`);

  // Important unmatched (>= 3 FM frequencies)
  const importantUnmatched = unmatchedRadios.filter(r => r.fmCount >= 3);
  if (importantUnmatched.length > 0) {
    await logger.warn('RAPPORT', `Avec fréquences FM ≥ 3 (radios IMPORTANTES sans matching) :`);
    for (const r of importantUnmatched.slice(0, 50)) {
      // Check where this radio appears in the pipeline
      const inFreqRadio = freqRadioEntries.some(e => e.radio_id === r.id);
      const arcomDepts = arcomEntries
        .filter(e => e.radio_nom.toLowerCase().trim() === r.nom.toLowerCase().trim())
        .map(e => e.departement);
      const indexDepts: string[] = [];
      for (const [d, ids] of deptRadioIds) {
        if (ids.has(r.id)) indexDepts.push(d);
      }

      const freqRadioStatus = inFreqRadio ? 'trouvée' : '404 ou 0 résultats';
      const arcomStatus = arcomDepts.length > 0 ? `trouvée (depts: ${arcomDepts.join(',')})` : 'NON trouvée';
      const indexStatus = indexDepts.length > 0 ? `présente (depts: ${indexDepts.join(',')})` : 'ABSENTE';

      // Determine root cause
      let conclusion: string;
      if (indexDepts.length === 0) {
        if (!inFreqRadio && arcomDepts.length === 0) {
          conclusion = 'Ni freq-radio ni Arcom ne connaissent cette radio → invisible pour le matcher';
        } else if (arcomDepts.length > 0) {
          conclusion = 'Arcom la connaît mais enrichDeptIndex n\'a pas matché le nom → vérifier la correspondance nom DB vs nom Arcom';
        } else {
          conclusion = 'freq-radio la connaît mais aucune donnée dept récupérée';
        }
      } else {
        conclusion = 'Présente dans l\'index mais aucun émetteur assigné — bug dans le round-robin ?';
      }

      await logger.warn('RAPPORT', `  ✗ ${r.nom} (cat ${r.cat}, ${r.fmCount} freq FM)`);
      await logger.warn('RAPPORT', `    → freq-radio : ${freqRadioStatus}`);
      await logger.warn('RAPPORT', `    → Arcom : ${arcomStatus}`);
      await logger.warn('RAPPORT', `    → Index fusionné : ${indexStatus}`);
      await logger.warn('RAPPORT', `    → Conclusion : ${conclusion}`);
    }
    if (importantUnmatched.length > 50) {
      await logger.warn('RAPPORT', `  ... et ${importantUnmatched.length - 50} autres radios non matchées avec ≥3 freq FM`);
    }
  }

  // ── INDEX PAR DÉPARTEMENT (sample: 69 + top 5 depts by emitter count) ──
  await logger.info('RAPPORT', sep2);
  await logger.info('RAPPORT', 'INDEX PAR DÉPARTEMENT');

  // Always include dept 69 (Radio Scoop diagnostic)
  const diagDepts = new Set(['69']);
  // Also top 5 depts by index size
  const deptsBySize = [...deptRadioIds.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5)
    .map(([d]) => d);
  for (const d of deptsBySize) diagDepts.add(d);

  for (const dept of diagDepts) {
    const radioIds = deptRadioIds.get(dept);
    if (!radioIds || radioIds.size === 0) {
      await logger.warn('RAPPORT', `[DEPT ${dept}] ABSENT de l'index — 0 radios`);
      continue;
    }

    // Count freq-radio vs arcom contributions
    const freqRadioDept = new Set(freqRadioEntries.filter(e => e.departement === dept).map(e => e.radio_id));
    const arcomDeptNames = new Set(arcomEntries.filter(e => e.departement === dept).map(e => e.radio_nom.toLowerCase().trim()));

    // Resolve radio names and emitter counts
    const radioDetails = [...radioIds].map(id => {
      const info = radioMap.get(id);
      const emCount = radioEmitterCounts.get(id) ?? 0;
      const fromFreq = freqRadioDept.has(id);
      const fromArcom = info ? arcomDeptNames.has(info.nom.toLowerCase().trim()) : false;
      const source = fromFreq && fromArcom ? 'freq+arcom' : fromFreq ? 'freq-radio' : fromArcom ? 'arcom' : '?';
      return { nom: info?.nom ?? id, emCount, source };
    }).sort((a, b) => b.emCount - a.emCount);

    const totalEm = radioDetails.reduce((s, r) => s + r.emCount, 0);
    await logger.info('RAPPORT', `[DEPT ${dept}] ${radioIds.size} radios dans l'index, ~${totalEm} émetteurs distribués`);
    const detailStr = radioDetails.map(r => `${r.nom} (${r.emCount}, ${r.source})`).join(', ');
    await logger.info('RAPPORT', `[DEPT ${dept}] Radios : ${detailStr}`);

    // Check for Radio Scoop specifically in dept 69
    if (dept === '69') {
      // Find Radio Scoop by name — never hardcode partial UUIDs
      let scoopId: string | undefined;
      for (const [id, info] of radioMap) {
        if (info.nom.toLowerCase().trim() === 'radio scoop') { scoopId = id; break; }
      }
      if (scoopId) {
        const scoopInIndex = radioIds.has(scoopId);
        const scoopEmitters = radioEmitterCounts.get(scoopId) ?? 0;
        if (scoopInIndex) {
          await logger.success('RAPPORT', `[DEPT 69] ✓ Radio Scoop (${scoopId.slice(0, 8)}) dans l'index, ${scoopEmitters} émetteurs`);
        } else {
          await logger.error('RAPPORT', `[DEPT 69] ✗ Radio Scoop (${scoopId.slice(0, 8)}) ABSENT de l'index → ${scoopEmitters} émetteurs`);
        }
      }
    }
  }

  await logger.info('RAPPORT', sep);
  await logger.info('RAPPORT', 'FIN DU RAPPORT');
  await logger.info('RAPPORT', sep);
}

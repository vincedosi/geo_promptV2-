/**
 * Radio Matcher — 4-pass matching algorithm for maximum coverage
 *
 * Pass 1: Exploitant name → radio (direct + fuzzy)
 * Pass 2: Frequency + department match against crawled data
 * Pass 3: Exploitant substring containment
 * Pass 4: Fallback — create radio from exploitant name
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';
import { RADIO_CATALOG, EXPLOITANT_TO_RADIO, type RadioCatalogEntry } from './radio-catalog';

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
  radios_updated: number;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\-']+/g, ' ').trim();
}

export async function matchRadios(
  supabase: SupabaseClient,
  logger: ImportLogger,
): Promise<MatchResult> {
  const result: MatchResult = {
    total_emetteurs: 0, matched_pass1: 0, matched_pass2: 0,
    matched_pass3: 0, matched_pass4: 0, total_matched: 0,
    orphelins: 0, pct_matching: 0, radios_created: 0, radios_updated: 0,
  };

  // ── Step 0: Seed all catalog radios into DB ───────────────────────────────
  await logger.phase('SEED_RADIOS', async () => {
    for (let i = 0; i < RADIO_CATALOG.length; i += 50) {
      const batch = RADIO_CATALOG.slice(i, i + 50).map((r: RadioCatalogEntry) => ({
        nom: r.nom,
        categorie_arcom: r.categorie_arcom,
        portee: r.portee,
        genre: r.genre,
        groupe_media: r.groupe_media,
      }));
      await supabase.from('radios').upsert(batch, { onConflict: 'nom' });
    }
    await logger.info('SEED_RADIOS', `${RADIO_CATALOG.length} radios du catalogue insérées/mises à jour`);
  });

  // Load all radios from DB
  const { data: allRadios } = await supabase.from('radios').select('id, nom');
  const radioByName = new Map<string, string>(); // normalized name → id
  for (const r of allRadios ?? []) {
    radioByName.set(normalize(r.nom), r.id);
  }

  // Load all emitters
  const { data: emetteurs } = await supabase
    .from('emetteurs_radio')
    .select('id, sta_nm_anfr, exploitant, frequence_mhz, departement, radio_id');

  if (!emetteurs || emetteurs.length === 0) {
    await logger.warn('INIT', 'Aucun émetteur en base — lancez d\'abord l\'import ANFR');
    return result;
  }

  result.total_emetteurs = emetteurs.length;
  const orphelins = emetteurs.filter(e => !e.radio_id);
  await logger.info('INIT', `${emetteurs.length} émetteurs en base, ${orphelins.length} orphelins à matcher`);

  // ── PASS 1: Direct exploitant → radio mapping ────────────────────────────
  await logger.phase('PASS_1', async () => {
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of orphelins) {
      const exp = (em.exploitant ?? '').trim().toUpperCase();
      if (!exp) continue;

      // Try exact mapping
      const radioName = EXPLOITANT_TO_RADIO[exp];
      if (radioName === '__SKIP__') continue;

      if (radioName) {
        const radioId = radioByName.get(normalize(radioName));
        if (radioId) {
          updates.push({ id: em.id, radio_id: radioId });
          em.radio_id = radioId; // mark as matched for subsequent passes
        }
      }
    }

    // Batch update
    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      for (const u of batch) {
        await supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id);
      }
    }

    result.matched_pass1 = updates.length;
    await logger.info('PASS_1', `Passe 1 (exploitant exact) : ${updates.length} matchés (${pct(updates.length, result.total_emetteurs)}%)`);
  });

  // ── PASS 2: Partial exploitant name match ─────────────────────────────────
  await logger.phase('PASS_2', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of stillOrphelins) {
      const exp = normalize(em.exploitant ?? '');
      if (!exp || exp.length < 3) continue;

      // Check if any radio name is contained in the exploitant
      for (const [normName, radioId] of radioByName) {
        if (normName.length >= 3 && exp.includes(normName)) {
          updates.push({ id: em.id, radio_id: radioId });
          em.radio_id = radioId;
          break;
        }
      }

      // Or if exploitant is contained in a radio name
      if (!em.radio_id) {
        for (const [normName, radioId] of radioByName) {
          if (exp.length >= 4 && normName.includes(exp)) {
            updates.push({ id: em.id, radio_id: radioId });
            em.radio_id = radioId;
            break;
          }
        }
      }
    }

    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      for (const u of batch) {
        await supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id);
      }
    }

    result.matched_pass2 = updates.length;
    const totalSoFar = result.matched_pass1 + result.matched_pass2;
    await logger.info('PASS_2', `Passe 2 (substring) : +${updates.length} matchés (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── PASS 3: Fuzzy matching — normalized exploitant words ──────────────────
  await logger.phase('PASS_3', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];

    for (const em of stillOrphelins) {
      const exp = (em.exploitant ?? '').trim();
      if (!exp || exp.length < 3) continue;

      // Split exploitant into words and try matching each significant word
      const words = normalize(exp).split(' ').filter(w => w.length >= 3);
      for (const word of words) {
        // Skip common non-radio words
        if (['sarl', 'sas', 'association', 'societe', 'radio', 'diffusion', 'france'].includes(word)) continue;

        for (const [normName, radioId] of radioByName) {
          if (normName.includes(word) && word.length >= 4) {
            updates.push({ id: em.id, radio_id: radioId });
            em.radio_id = radioId;
            break;
          }
        }
        if (em.radio_id) break;
      }
    }

    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      for (const u of batch) {
        await supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id);
      }
    }

    result.matched_pass3 = updates.length;
    const totalSoFar = result.matched_pass1 + result.matched_pass2 + result.matched_pass3;
    await logger.info('PASS_3', `Passe 3 (fuzzy words) : +${updates.length} matchés (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── PASS 4: Create radio from exploitant name (last resort) ───────────────
  await logger.phase('PASS_4', async () => {
    const stillOrphelins = emetteurs.filter(e => !e.radio_id);
    const updates: Array<{ id: string; radio_id: string }> = [];
    let created = 0;

    // Group orphelins by exploitant
    const byExploitant = new Map<string, typeof stillOrphelins>();
    for (const em of stillOrphelins) {
      const exp = (em.exploitant ?? '').trim();
      if (!exp || exp.length < 2 || exp.length > 60) continue;
      // Skip known technical operators
      if (/^(TOWERCAST|TDF|ITAS|ONECAST|DIFFUSION PLUS|GIP|SARL|SAS)/i.test(exp)) continue;

      if (!byExploitant.has(exp)) byExploitant.set(exp, []);
      byExploitant.get(exp)!.push(em);
    }

    for (const [exp, ems] of byExploitant) {
      // Create a new radio entry
      const { data: newRadio } = await supabase
        .from('radios')
        .upsert({ nom: exp }, { onConflict: 'nom' })
        .select('id')
        .single();

      if (newRadio) {
        radioByName.set(normalize(exp), newRadio.id);
        created++;
        for (const em of ems) {
          updates.push({ id: em.id, radio_id: newRadio.id });
          em.radio_id = newRadio.id;
        }
      }
    }

    for (let i = 0; i < updates.length; i += 500) {
      const batch = updates.slice(i, i + 500);
      for (const u of batch) {
        await supabase.from('emetteurs_radio').update({ radio_id: u.radio_id }).eq('id', u.id);
      }
    }

    result.matched_pass4 = updates.length;
    result.radios_created = created;
    const totalSoFar = result.matched_pass1 + result.matched_pass2 + result.matched_pass3 + result.matched_pass4;
    await logger.info('PASS_4', `Passe 4 (auto-create) : +${updates.length} matchés, ${created} radios créées (total ${pct(totalSoFar, result.total_emetteurs)}%)`);
  });

  // ── Final stats ───────────────────────────────────────────────────────────
  result.total_matched = result.matched_pass1 + result.matched_pass2 + result.matched_pass3 + result.matched_pass4;
  result.orphelins = result.total_emetteurs - result.total_matched;
  // Count already-matched emitters from before this run
  const alreadyMatched = emetteurs.length - orphelins.length;
  result.total_matched += alreadyMatched;
  result.orphelins = result.total_emetteurs - result.total_matched;
  result.pct_matching = result.total_emetteurs > 0
    ? Math.round((result.total_matched / result.total_emetteurs) * 1000) / 10
    : 0;

  // Log orphelins detail
  const finalOrphelins = emetteurs.filter(e => !e.radio_id);
  if (finalOrphelins.length > 0) {
    await logger.warn('ORPHELINS', `${finalOrphelins.length} émetteurs orphelins restants (${pct(finalOrphelins.length, result.total_emetteurs)}%)`, {
      sample: finalOrphelins.slice(0, 20).map(e => ({
        sta_nm_anfr: e.sta_nm_anfr,
        frequence: e.frequence_mhz,
        dept: e.departement,
        exploitant: e.exploitant,
      })),
    });
  }

  await logger.success('FINALIZE', `Matching terminé : ${result.total_matched}/${result.total_emetteurs} (${result.pct_matching}%) — P1:${result.matched_pass1} P2:${result.matched_pass2} P3:${result.matched_pass3} P4:${result.matched_pass4}`);

  return result;
}

function pct(n: number, total: number): string {
  return total > 0 ? (n / total * 100).toFixed(1) : '0';
}

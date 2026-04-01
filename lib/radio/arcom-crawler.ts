/**
 * Arcom "Ma Radio FM" crawler — radio matching via ANFR exploitant names
 * Instrumented with ImportLogger for granular phase-by-phase logging.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ImportLogger } from './import-logger';

// Known national/major radios with their typical categories
const KNOWN_RADIOS: Record<string, { categorie: string; portee: string; genre: string; groupe: string }> = {
  'France Inter':     { categorie: 'E', portee: 'nationale', genre: 'generaliste', groupe: 'Radio France' },
  'France Info':      { categorie: 'E', portee: 'nationale', genre: 'info_talk', groupe: 'Radio France' },
  'France Culture':   { categorie: 'E', portee: 'nationale', genre: 'culturelle', groupe: 'Radio France' },
  'France Musique':   { categorie: 'E', portee: 'nationale', genre: 'musicale', groupe: 'Radio France' },
  'France Bleu':      { categorie: 'E', portee: 'regionale', genre: 'generaliste', groupe: 'Radio France' },
  'FIP':              { categorie: 'E', portee: 'nationale', genre: 'musicale', groupe: 'Radio France' },
  'Mouv':             { categorie: 'E', portee: 'nationale', genre: 'musicale', groupe: 'Radio France' },
  'NRJ':              { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'NRJ Group' },
  'Chérie FM':        { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'NRJ Group' },
  'Nostalgie':        { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'NRJ Group' },
  'Rire et Chansons': { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'NRJ Group' },
  'RTL':              { categorie: 'E', portee: 'nationale', genre: 'generaliste', groupe: 'RTL Group' },
  'RTL2':             { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'RTL Group' },
  'Fun Radio':        { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'RTL Group' },
  'Europe 1':         { categorie: 'E', portee: 'nationale', genre: 'generaliste', groupe: 'Lagardère' },
  'Virgin Radio':     { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Lagardère' },
  'RFM':              { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Lagardère' },
  'Europe 2':         { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Lagardère' },
  'RMC':              { categorie: 'E', portee: 'nationale', genre: 'info_talk', groupe: 'Altice' },
  'BFM Business':     { categorie: 'D', portee: 'nationale', genre: 'info_talk', groupe: 'Altice' },
  'Skyrock':          { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Skyrock' },
  'Radio Classique':  { categorie: 'D', portee: 'nationale', genre: 'culturelle', groupe: 'LVMH' },
  'TSF Jazz':         { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Indépendant' },
  'Oüi FM':           { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Indépendant' },
  'Sud Radio':        { categorie: 'D', portee: 'nationale', genre: 'generaliste', groupe: 'Fiducial' },
  'RCF':              { categorie: 'A', portee: 'regionale', genre: 'communautaire', groupe: 'RCF' },
  'Radio FG':         { categorie: 'D', portee: 'nationale', genre: 'musicale', groupe: 'Indépendant' },
  'Contact FM':       { categorie: 'B', portee: 'regionale', genre: 'musicale', groupe: 'Indépendant' },
  'Voltage':          { categorie: 'B', portee: 'locale', genre: 'musicale', groupe: 'Indépendant' },
};

type ProgressCallback = (event: Record<string, unknown>) => void;

export async function crawlAndMatchRadios(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
  importLogId: string,
): Promise<{ radiosCreated: number; emetteursMatcher: number }> {
  const logger = new ImportLogger(supabase, importLogId, onProgress);

  await logger.info('INIT', 'Début de l\'enrichissement radios');

  let radiosCreated = 0;
  let emetteursMatcher = 0;

  // ── Phase LOAD_KNOWN ──────────────────────────────────────────────────────
  await logger.phase('LOAD_KNOWN', async () => {
    const knownNames = Object.keys(KNOWN_RADIOS);
    await logger.info('LOAD_KNOWN', `${knownNames.length} radios nationales connues à charger`);

    for (let i = 0; i < knownNames.length; i += 50) {
      const batch = knownNames.slice(i, i + 50).map(nom => ({
        nom,
        categorie_arcom: KNOWN_RADIOS[nom].categorie,
        portee: KNOWN_RADIOS[nom].portee,
        genre: KNOWN_RADIOS[nom].genre,
        groupe_media: KNOWN_RADIOS[nom].groupe,
      }));

      const { error } = await supabase.from('radios').upsert(batch, { onConflict: 'nom' });
      if (!error) radiosCreated += batch.length;
      else await logger.warn('LOAD_KNOWN', `Erreur upsert batch : ${error.message}`);
    }
    await logger.info('LOAD_KNOWN', `${radiosCreated} radios de référence créées/mises à jour`);
  });

  // ── Phase FETCH_EXPLOITANTS ───────────────────────────────────────────────
  const uniqueExploitants = await logger.phase('FETCH_EXPL', async () => {
    const { data: exploitants, error } = await supabase
      .from('emetteurs_radio')
      .select('exploitant')
      .not('exploitant', 'is', null);

    if (error) throw new Error(`Fetch exploitants: ${error.message}`);

    const unique = [...new Set(
      (exploitants ?? []).map((e: { exploitant: string | null }) => (e.exploitant ?? '').trim()).filter(Boolean)
    )];
    await logger.info('FETCH_EXPL', `${unique.length} exploitants distincts trouvés`);
    return unique;
  });

  // ── Phase MATCHING ────────────────────────────────────────────────────────
  const exploitantRadios = await logger.phase('MATCHING', async () => {
    const { data: allRadios } = await supabase.from('radios').select('id, nom');

    const radioMap = new Map<string, string>();
    for (const r of allRadios ?? []) {
      radioMap.set(normalize(r.nom), r.id);
      radioMap.set(normalize(r.nom.replace(/\s*(FM|fm|SAS|SARL|SA)\s*$/i, '')), r.id);
    }

    const result = new Map<string, string>();
    let directMatch = 0, partialMatch = 0, created = 0, skipped = 0;

    for (const exp of uniqueExploitants) {
      const normExp = normalize(exp);
      let radioId = radioMap.get(normExp);

      if (radioId) { directMatch++; }
      else {
        for (const [normName, id] of radioMap) {
          if (normExp.includes(normName) && normName.length > 3) {
            radioId = id;
            partialMatch++;
            break;
          }
        }
      }

      if (!radioId && exp.length > 2 && exp.length < 50 && !exp.match(/^(TOWERCAST|TDF|ITAS|ONECAST)/i)) {
        const { data: newRadio } = await supabase
          .from('radios')
          .upsert({ nom: exp }, { onConflict: 'nom' })
          .select('id')
          .single();

        if (newRadio) {
          radioId = newRadio.id;
          radioMap.set(normExp, radioId!);
          created++;
          radiosCreated++;
        }
      } else if (!radioId) {
        skipped++;
      }

      if (radioId) result.set(exp, radioId);
    }

    await logger.info('MATCHING', `Direct : ${directMatch}, Partiel : ${partialMatch}, Créés : ${created}, Ignorés : ${skipped}`, { directMatch, partialMatch, created, skipped });
    return result;
  });

  // ── Phase UPDATE_FK ───────────────────────────────────────────────────────
  await logger.phase('UPDATE_FK', async () => {
    for (const [exploitant, radioId] of exploitantRadios) {
      const { count } = await supabase
        .from('emetteurs_radio')
        .update({ radio_id: radioId })
        .eq('exploitant', exploitant)
        .is('radio_id', null);

      emetteursMatcher += count ?? 0;
    }
    await logger.info('UPDATE_FK', `${emetteursMatcher} émetteurs associés à une radio`);
  });

  // ── Phase FINALIZE ────────────────────────────────────────────────────────
  const orphelins = await supabase
    .from('emetteurs_radio')
    .select('*', { count: 'exact', head: true })
    .is('radio_id', null);

  await logger.success('FINALIZE', `Enrichissement terminé : ${radiosCreated} radios, ${emetteursMatcher} émetteurs associés, ${orphelins.count ?? 0} orphelins`);

  return { radiosCreated, emetteursMatcher };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
}

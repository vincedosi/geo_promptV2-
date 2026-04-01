/**
 * Arcom "Ma Radio FM" crawler — scrapes radio station data
 *
 * Strategy: crawl by department to get radio name + frequency + city mappings,
 * then match with ANFR emitters by frequency proximity.
 *
 * Rate limited: 1 request/second, polite User-Agent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// All 101 French department codes
const DEPTS = [
  '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15',
  '16','17','18','19','2A','2B','21','22','23','24','25','26','27','28','29',
  '30','31','32','33','34','35','36','37','38','39','40','41','42','43','44',
  '45','46','47','48','49','50','51','52','53','54','55','56','57','58','59',
  '60','61','62','63','64','65','66','67','68','69','70','71','72','73','74',
  '75','76','77','78','79','80','81','82','83','84','85','86','87','88','89',
  '90','91','92','93','94','95','971','972','973','974','976',
];

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

type ProgressCallback = (event: { type: string; message: string; [k: string]: unknown }) => void;

/**
 * Strategy: instead of crawling Arcom (which may block),
 * use the ANFR exploitant names to deduce radio names,
 * then enrich with the known radio database.
 */
export async function crawlAndMatchRadios(
  supabase: SupabaseClient,
  onProgress: ProgressCallback,
): Promise<{ radiosCreated: number; emetteursMatcher: number }> {

  // 1. Get distinct exploitant names from emetteurs_radio
  onProgress({ type: 'status', message: 'Récupération des exploitants ANFR...' });

  const { data: exploitants, error } = await supabase
    .from('emetteurs_radio')
    .select('exploitant')
    .not('exploitant', 'is', null);

  if (error) throw new Error(`Fetch exploitants: ${error.message}`);

  // Deduplicate
  const uniqueExploitants = [...new Set(
    (exploitants ?? []).map((e: { exploitant: string | null }) => (e.exploitant ?? '').trim()).filter(Boolean)
  )];

  onProgress({ type: 'progress', message: `${uniqueExploitants.length} exploitants distincts trouvés` });

  // 2. Match known radios
  let radiosCreated = 0;
  let emetteursMatcher = 0;

  // First, seed the known radios
  onProgress({ type: 'status', message: 'Création des radios connues...' });
  const knownNames = Object.keys(KNOWN_RADIOS);

  for (let i = 0; i < knownNames.length; i += 50) {
    const batch = knownNames.slice(i, i + 50).map(nom => ({
      nom,
      categorie_arcom: KNOWN_RADIOS[nom].categorie,
      portee: KNOWN_RADIOS[nom].portee,
      genre: KNOWN_RADIOS[nom].genre,
      groupe_media: KNOWN_RADIOS[nom].groupe,
    }));

    const { error: upsertErr } = await supabase
      .from('radios')
      .upsert(batch, { onConflict: 'nom' });

    if (!upsertErr) radiosCreated += batch.length;
  }

  onProgress({ type: 'progress', message: `${radiosCreated} radios de référence créées/mises à jour` });

  // 3. Try to match exploitant names to radio names
  onProgress({ type: 'status', message: 'Matching exploitants → radios...' });

  // Get all radios from DB
  const { data: allRadios } = await supabase
    .from('radios')
    .select('id, nom');

  const radioMap = new Map<string, string>(); // normalized name → id
  for (const r of allRadios ?? []) {
    radioMap.set(normalize(r.nom), r.id);
    // Also add without common suffixes
    radioMap.set(normalize(r.nom.replace(/\s*(FM|fm|SAS|SARL|SA)\s*$/i, '')), r.id);
  }

  // Also create radios from exploitant names that look like radio names
  const exploitantRadios = new Map<string, string>(); // exploitant → radio_id
  for (const exp of uniqueExploitants) {
    // Try direct match
    const normExp = normalize(exp);
    let radioId = radioMap.get(normExp);

    // Try partial match (exploitant contains radio name)
    if (!radioId) {
      for (const [normName, id] of radioMap) {
        if (normExp.includes(normName) && normName.length > 3) {
          radioId = id;
          break;
        }
      }
    }

    // Create new radio if exploitant looks like one (heuristic)
    if (!radioId && exp.length > 2 && exp.length < 50 && !exp.match(/^(TOWERCAST|TDF|ITAS|ONECAST)/i)) {
      const { data: newRadio } = await supabase
        .from('radios')
        .upsert({ nom: exp }, { onConflict: 'nom' })
        .select('id')
        .single();

      if (newRadio) {
        radioId = newRadio.id;
        radioMap.set(normExp, radioId!);
        radiosCreated++;
      }
    }

    if (radioId) exploitantRadios.set(exp, radioId);
  }

  onProgress({ type: 'progress', message: `${exploitantRadios.size} exploitants matchés` });

  // 4. Update emetteurs_radio with radio_id by exploitant name
  onProgress({ type: 'status', message: 'Mise à jour des FK radio_id...' });

  for (const [exploitant, radioId] of exploitantRadios) {
    const { count } = await supabase
      .from('emetteurs_radio')
      .update({ radio_id: radioId })
      .eq('exploitant', exploitant)
      .is('radio_id', null);

    emetteursMatcher += count ?? 0;
  }

  onProgress({
    type: 'done',
    message: `Matching terminé : ${radiosCreated} radios, ${emetteursMatcher} émetteurs matchés`,
    radios_created: radiosCreated,
    emetteurs_matched: emetteursMatcher,
  });

  return { radiosCreated, emetteursMatcher };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
}

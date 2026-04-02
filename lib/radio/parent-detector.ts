/**
 * Parent radio detector — finds parent networks for local radio variants
 *
 * Examples:
 *  "NRJ Cherbourg" → parent "NRJ"
 *  "Fun Radio Atlantique" → parent "Fun Radio"
 *  "ici Normandie" → parent "France Bleu"
 *  "Chérie FM Bordeaux" → parent "Chérie FM"
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportLogger } from './import-logger';

// Special mappings for renamed brands
const BRAND_MAPPINGS: Record<string, string> = {
  'ici': 'France Bleu',
};

export interface ParentResult {
  detected: number;
  independent: number;
}

export async function detectParentRadios(
  supabase: SupabaseClient,
  logger: ImportLogger,
): Promise<ParentResult> {
  // Load all radios with emitter counts
  const { data: allRadios } = await supabase
    .from('radios')
    .select('id, nom, parent_radio_id')
    .limit(100000);

  if (!allRadios) return { detected: 0, independent: 0 };

  // Build lookup of radios that HAVE emitters (potential parents)
  const { data: withEmitters } = await supabase
    .from('emetteurs_radio')
    .select('radio_id')
    .not('radio_id', 'is', null)
    .limit(100000);

  const radioIdsWithEmitters = new Set((withEmitters ?? []).map(e => e.radio_id));

  // Build name→id map for parent candidates (only those with emitters)
  const parentCandidates = new Map<string, string>(); // lowercase name → id
  for (const r of allRadios) {
    if (radioIdsWithEmitters.has(r.id)) {
      parentCandidates.set(r.nom.toLowerCase().trim(), r.id);
    }
  }

  // Find radios WITHOUT emitters and without existing parent
  const orphans = allRadios.filter(r =>
    !radioIdsWithEmitters.has(r.id) && !r.parent_radio_id
  );

  await logger.info('PARENT', `${orphans.length} radios sans émetteurs à analyser, ${parentCandidates.size} parents potentiels`);

  let detected = 0;
  const updates: Array<{ id: string; parent_id: string; nom: string; parent_nom: string }> = [];

  for (const radio of orphans) {
    const nom = radio.nom.trim();
    const nomLower = nom.toLowerCase();

    // Method 1: "ici {X}" → France Bleu
    if (nomLower.startsWith('ici ')) {
      const fbId = parentCandidates.get('france bleu');
      if (fbId) {
        updates.push({ id: radio.id, parent_id: fbId, nom, parent_nom: 'France Bleu' });
        detected++;
        continue;
      }
    }

    // Method 2: Brand mapping
    const firstWord = nomLower.split(/[\s\-]/)[0];
    if (BRAND_MAPPINGS[firstWord]) {
      const mappedId = parentCandidates.get(BRAND_MAPPINGS[firstWord].toLowerCase());
      if (mappedId) {
        updates.push({ id: radio.id, parent_id: mappedId, nom, parent_nom: BRAND_MAPPINGS[firstWord] });
        detected++;
        continue;
      }
    }

    // Method 3: Prefix matching — try progressively shorter prefixes
    const words = nom.split(/[\s\-\/]+/);
    let found = false;
    for (let len = words.length - 1; len >= 1; len--) {
      const prefix = words.slice(0, len).join(' ').toLowerCase().trim();
      if (prefix.length < 2) continue;
      const parentId = parentCandidates.get(prefix);
      if (parentId && parentId !== radio.id) {
        const parentNom = allRadios.find(r => r.id === parentId)?.nom ?? prefix;
        updates.push({ id: radio.id, parent_id: parentId, nom, parent_nom: parentNom });
        detected++;
        found = true;
        break;
      }
    }
    if (found) continue;

    // Method 4: Check if name contains a known parent name (for "100% Pays Catalan" → "100%")
    for (const [pName, pId] of parentCandidates) {
      if (pName.length >= 3 && nomLower.startsWith(pName + ' ') && pId !== radio.id) {
        const parentNom = allRadios.find(r => r.id === pId)?.nom ?? pName;
        updates.push({ id: radio.id, parent_id: pId, nom, parent_nom: parentNom });
        detected++;
        break;
      }
    }
  }

  // Batch update parent_radio_id
  for (const u of updates) {
    await supabase.from('radios').update({ parent_radio_id: u.parent_id }).eq('id', u.id);
  }

  // Log some examples
  const examples = updates.slice(0, 10).map(u => `${u.nom} → ${u.parent_nom}`);
  await logger.info('PARENT', `${detected} parents détectés. Exemples : ${examples.join(', ')}`);
  await logger.info('PARENT', `${orphans.length - detected} radios indépendantes restantes`);

  return { detected, independent: orphans.length - detected };
}

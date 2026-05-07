/**
 * scripts/import_abstention_2022.ts
 *
 * Importe le taux d'abstention de la présidentielle 2022 (T2) par code postal,
 * depuis le fichier officiel data.gouv.fr (Ministère Intérieur).
 *
 * Pipeline :
 *   1. Télécharge le CSV officiel (~13 MB, 69 683 lignes BV).
 *   2. Parse en latin1 (ISO-8859-1, séparateur ';').
 *   3. Agrège par code commune INSEE (sum inscrits, sum abstentions).
 *   4. Joint avec postal_code_commune pour avoir CP → 1..N communes.
 *   5. Calcule moyenne pondérée du taux par CP (pondération = inscrits commune).
 *   6. UPSERT batch dans dataset_abstention_2022.
 *
 * Usage :
 *   npx tsx scripts/import_abstention_2022.ts
 *
 * Variables d'environnement (.env.local) :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERREUR: NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant.');
  process.exit(1);
}

const CSV_URL = 'https://www.data.gouv.fr/api/1/datasets/r/4dfd05a9-094e-4043-8a19-43b6b6bbe086';

interface CommuneAgg {
  code_dept: string;
  code_commune_insee: string; // INSEE 5-6 chars
  inscrits: number;
  abstentions: number;
}

/**
 * Mapping ancien code dept Min.Intérieur ('ZA', 'ZB'...) → code dept INSEE.
 * Convention DROM/COM : tous codés sous "97" en INSEE, le 3ème chiffre identifie
 * le territoire (971 Guadeloupe, 972 Martinique, etc.). Le CSV présidentielle
 * encode le préfixe '9' du code commune dans `code commune` lui-même
 * (ex: ZA;101 → INSEE 97101, ZB;201 → INSEE 97201).
 *
 * Donc pour DROM/COM :
 *   • INSEE complet = '97' + code_commune_CSV (3 chars) = 5 chars
 *   • code_dept = '97' + premier chiffre du code_commune_CSV
 */
const DROM_PREFIX: Record<string, string> = {
  ZA: '97', // Guadeloupe (commune CSV commence par 1 → INSEE 971xx)
  ZB: '97', // Martinique (commune CSV commence par 2 → INSEE 972xx)
  ZC: '97', // Guyane (commune CSV commence par 3 → INSEE 973xx)
  ZD: '97', // La Réunion (commune CSV commence par 4 → INSEE 974xx)
  ZM: '97', // Mayotte (commune CSV commence par 6 → INSEE 976xx)
  ZS: '97', // Saint-Pierre-et-Miquelon (975)
  ZN: '98', // Nouvelle-Calédonie (988)
  ZP: '98', // Polynésie française (987)
  ZW: '98', // Wallis-et-Futuna (986)
};

/**
 * Construit le code commune INSEE 5-6 chars selon la convention détectée.
 * - Métropole : dept(2) + commune(3, padStart 0) = 5 chars
 *   Ex: '01' + '001' = '01001' ; '2A' + '004' = '2A004'
 * - DROM/COM (codes Z*) : '97' ou '98' + commune_CSV(3) = 5 chars
 *   Ex: ZA;101 → '97' + '101' = '97101'
 */
function buildInsee(dept: string, communeRaw: string): string {
  const commune3 = communeRaw.padStart(3, '0');
  if (DROM_PREFIX[dept]) {
    return DROM_PREFIX[dept] + commune3;
  }
  const normDept = dept.length === 1 ? '0' + dept : dept;
  return normDept + commune3;
}

/** Code département INSEE pour stockage. */
function getInseeDept(dept: string, communeRaw: string): string {
  if (DROM_PREFIX[dept]) {
    return DROM_PREFIX[dept] + communeRaw.padStart(3, '0').charAt(0);
  }
  return dept.length === 1 ? '0' + dept : dept;
}

async function main() {
  console.log('▸ Téléchargement CSV présidentielle 2022 T2…');
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  // Le fichier est en ISO-8859-1 (latin1), pas UTF-8
  const text = new TextDecoder('iso-8859-1').decode(buf);
  console.log(`  → ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB téléchargés`);

  // Parse CSV ; → lignes, séparateur ;
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  console.log(`▸ Parsing ${lines.length - 1} lignes (1 par bureau de vote)…`);
  const header = lines[0].split(';');

  const idx = {
    code_dept:    header.indexOf('Code du département'),
    code_commune: header.indexOf('Code de la commune'),
    inscrits:     header.indexOf('Inscrits'),
    abstentions:  header.indexOf('Abstentions'),
  };
  if (Object.values(idx).some(v => v < 0)) {
    throw new Error(`Colonnes manquantes : ${JSON.stringify(idx)}`);
  }

  // Agrégation par code commune INSEE (sum inscrits/abstentions sur tous les BV)
  // Note : un BV peut apparaître plusieurs fois (1 row par candidat). On dédoublonne
  // par (commune, b.vote) en lisant uniquement la 1ère row de chaque BV.
  const idxBv = header.indexOf('Code du b.vote');
  const seenBv = new Set<string>();
  const byCommune = new Map<string, CommuneAgg>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 10) continue;
    const dept = cols[idx.code_dept].trim();
    if (dept === 'ZX' || dept === 'ZZ') continue; // votes diplomatiques (Français à l'étranger), pas de CP
    const commune3 = cols[idx.code_commune].trim();
    const bv = cols[idxBv].trim();
    const insee = buildInsee(dept, commune3);
    const bvKey = `${insee}-${bv}`;
    if (seenBv.has(bvKey)) continue;
    seenBv.add(bvKey);

    const inscrits = parseInt(cols[idx.inscrits].replace(/[ ,]/g, ''), 10);
    const abstentions = parseInt(cols[idx.abstentions].replace(/[ ,]/g, ''), 10);
    if (!Number.isFinite(inscrits) || !Number.isFinite(abstentions)) continue;

    const cur = byCommune.get(insee) ?? { code_dept: getInseeDept(dept, commune3), code_commune_insee: insee, inscrits: 0, abstentions: 0 };
    cur.inscrits += inscrits;
    cur.abstentions += abstentions;
    byCommune.set(insee, cur);
  }

  console.log(`  → ${byCommune.size} communes agrégées`);

  // Récupère le mapping CP ↔ commune INSEE depuis la DB
  console.log('▸ Récupération mapping CP ↔ commune INSEE…');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cpRows: Array<{ code_postal: string; code_commune: string }> = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('postal_code_commune')
      .select('code_postal, code_commune')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`postal_code_commune: ${error.message}`);
    if (!data || data.length === 0) break;
    cpRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  → ${cpRows.length} mappings CP↔commune chargés`);

  // Mapping CP → commune INSEE
  // Cas particuliers villes-arrondissements (Paris, Marseille, Lyon) :
  //   • Le CSV présidentielle 2022 NE LES SCINDE PAS en arrondissements :
  //     Paris est sous insee=75056, Marseille sous 13055, Lyon sous 69123.
  //   • Or postal_code_commune mappe les CPs 75xxx vers 75101-75120 (arrondiss.),
  //     les CPs 13xxx Marseille vers 13201-13216, les CPs 69xxx Lyon vers 69381-69389.
  //   • Sans fallback → ZÉRO CP Paris/Marseille/Lyon dans le dataset.
  // Solution : si un CP est mappé vers un code commune INSEE non trouvé dans
  // le CSV, on tente un fallback via la commune-mère (75056 / 13055 / 69123).
  const ARRONDISSEMENT_FALLBACK: Record<string, string> = {};
  // Paris : 75101-75120 → 75056
  for (let a = 1; a <= 20; a++) ARRONDISSEMENT_FALLBACK[`751${a.toString().padStart(2, '0')}`] = '75056';
  // Marseille : 13201-13216 → 13055
  for (let a = 1; a <= 16; a++) ARRONDISSEMENT_FALLBACK[`132${a.toString().padStart(2, '0')}`] = '13055';
  // Lyon : 69381-69389 → 69123
  for (let a = 1; a <= 9; a++) ARRONDISSEMENT_FALLBACK[`6938${a}`] = '69123';

  // Calcul moyenne pondérée taux abstention par CP
  const byCp = new Map<string, { inscrits: number; abstentions: number; communes: Set<string>; dept: string }>();
  let nFallback = 0;
  for (const row of cpRows) {
    let insee = row.code_commune;
    let agg = byCommune.get(insee);
    // Fallback ville-arrondissement
    if (!agg && ARRONDISSEMENT_FALLBACK[insee]) {
      insee = ARRONDISSEMENT_FALLBACK[insee];
      agg = byCommune.get(insee);
      if (agg) nFallback++;
    }
    if (!agg) continue;
    const cur = byCp.get(row.code_postal) ?? { inscrits: 0, abstentions: 0, communes: new Set(), dept: agg.code_dept };
    cur.inscrits += agg.inscrits;
    cur.abstentions += agg.abstentions;
    cur.communes.add(insee);
    byCp.set(row.code_postal, cur);
  }
  console.log(`  → ${byCp.size} CPs avec data abstention (${nFallback} CPs résolus via fallback arrondissements)`);

  // UPSERT batch
  console.log('▸ Insertion en DB (batch 500)…');
  const rows = Array.from(byCp.entries()).map(([cp, agg]) => ({
    code_postal: cp,
    taux_abstention: Math.round((agg.abstentions / agg.inscrits) * 10000) / 100, // 2 décimales
    inscrits: agg.inscrits,
    abstentions: agg.abstentions,
    nb_communes: agg.communes.size,
    code_dept: agg.dept,
  }));

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from('dataset_abstention_2022')
      .upsert(batch, { onConflict: 'code_postal' });
    if (error) throw new Error(`upsert batch ${i}: ${error.message}`);
    inserted += batch.length;
    process.stdout.write(`\r  → ${inserted}/${rows.length} CPs upsertés`);
  }
  console.log('');

  // Stats finales
  const tauxList = rows.map(r => r.taux_abstention).sort((a, b) => a - b);
  const min = tauxList[0];
  const max = tauxList[tauxList.length - 1];
  const median = tauxList[Math.floor(tauxList.length / 2)];
  const mean = tauxList.reduce((s, x) => s + x, 0) / tauxList.length;
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✓ ${rows.length} CPs importés`);
  console.log(`  Taux abstention : min ${min}% · median ${median}% · mean ${mean.toFixed(2)}% · max ${max}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(e => {
  console.error('❌', e);
  process.exit(1);
});

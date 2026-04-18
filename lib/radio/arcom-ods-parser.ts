/**
 * Arcom ODS parser — reads the official radio reference file
 *
 * Columns: Nom du service | Nom du titulaire | Catégorie | Type | Fréquence | Bloc
 */

import * as XLSX from 'xlsx';

export interface ArcomRadioEntry {
  nom_service: string;
  nom_titulaire: string;
  categorie_arcom: string; // A, B, C, D, E, P
  categorie_label: string;
  type: 'FM' | 'DAB+';
  frequence_mhz: number;
  bloc: string | null;
}

export interface ArcomRadioAggregated {
  nom: string;
  titulaire: string;
  categorie_arcom: string;
  categorie_label: string;
  frequences_fm: number[];
  frequences_dab: number[];
  blocs_dab: string[];
  nb_frequences_total: number;
  portee: 'nationale' | 'regionale' | 'locale';
}

/**
 * Parse an Arcom ODS file buffer into individual entries.
 */
export function parseArcomODS(fileBuffer: Buffer): ArcomRadioEntry[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Fichier ODS vide — aucune feuille trouvée');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });

  if (rows.length === 0) throw new Error('Fichier ODS vide — aucune ligne de données');

  const results: ArcomRadioEntry[] = [];
  let skipped = 0;

  for (const row of rows) {
    // Column names may vary — try common patterns
    const nomService = (
      row['Nom du service'] ?? row['nom_service'] ?? row['Nom service'] ??
      Object.values(row)[0] ?? ''
    ).toString().trim();

    const nomTitulaire = (
      row['Nom du titulaire'] ?? row['nom_titulaire'] ?? row['Titulaire'] ??
      Object.values(row)[1] ?? ''
    ).toString().trim();

    const categorieRaw = (
      row['Catégorie'] ?? row['Categorie'] ?? row['categorie'] ??
      Object.values(row)[2] ?? ''
    ).toString().trim();

    const typeRaw = (
      row['Type'] ?? row['type'] ??
      Object.values(row)[3] ?? ''
    ).toString().trim().toUpperCase();

    const freqRaw = (
      row['Fréquence'] ?? row['Frequence'] ?? row['frequence'] ??
      Object.values(row)[4] ?? ''
    ).toString().trim();

    const bloc = (
      row['Bloc'] ?? row['bloc'] ??
      Object.values(row)[5] ?? ''
    ).toString().trim() || null;

    // Skip header-like rows or empty rows
    if (!nomService || nomService.toLowerCase().includes('nom du service')) {
      skipped++;
      continue;
    }

    // Extract category letter (first char of "D - Services de radio thématiques")
    const catLetter = categorieRaw.charAt(0).toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E', 'P'].includes(catLetter)) {
      skipped++;
      continue;
    }

    // Parse type
    const type: 'FM' | 'DAB+' = typeRaw.includes('DAB') ? 'DAB+' : 'FM';

    // Parse frequency: "95.00 MHz" → 95.0, "192.000 MHz" → 192.0
    const freqStr = freqRaw.replace(/[^0-9.,]/g, '').replace(',', '.').trim();
    const freq = parseFloat(freqStr);
    if (isNaN(freq) || freq <= 0) {
      skipped++;
      continue;
    }

    results.push({
      nom_service: nomService,
      nom_titulaire: nomTitulaire,
      categorie_arcom: catLetter,
      categorie_label: categorieRaw,
      type,
      frequence_mhz: Math.round(freq * 10) / 10, // Round to 1 decimal
      bloc,
    });
  }

  return results;
}

/**
 * Aggregate entries by radio name → one record per radio with all frequencies.
 */
export function aggregateByRadio(entries: ArcomRadioEntry[]): ArcomRadioAggregated[] {
  const map = new Map<string, ArcomRadioAggregated>();

  for (const e of entries) {
    const key = e.nom_service.toUpperCase();
    let agg = map.get(key);

    if (!agg) {
      agg = {
        nom: e.nom_service,
        titulaire: e.nom_titulaire,
        categorie_arcom: e.categorie_arcom,
        categorie_label: e.categorie_label,
        frequences_fm: [],
        frequences_dab: [],
        blocs_dab: [],
        nb_frequences_total: 0,
        portee: 'locale',
      };
      map.set(key, agg);
    }

    if (e.type === 'FM' && !agg.frequences_fm.includes(e.frequence_mhz)) {
      agg.frequences_fm.push(e.frequence_mhz);
    }
    if (e.type === 'DAB+') {
      if (!agg.frequences_dab.includes(e.frequence_mhz)) agg.frequences_dab.push(e.frequence_mhz);
      if (e.bloc && !agg.blocs_dab.includes(e.bloc)) agg.blocs_dab.push(e.bloc);
    }
    agg.nb_frequences_total = agg.frequences_fm.length + agg.frequences_dab.length;
  }

  // Deduce portée from number of FM frequencies
  for (const agg of map.values()) {
    const nbFm = agg.frequences_fm.length;
    agg.portee = nbFm >= 50 ? 'nationale' : nbFm >= 10 ? 'regionale' : 'locale';
  }

  return [...map.values()].sort((a, b) => b.nb_frequences_total - a.nb_frequences_total);
}

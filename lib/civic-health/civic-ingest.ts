/**
 * Ingestion nationale santé environnementale → pollen_map_daily + atmo_map_daily.
 *
 * Pipeline (étapes nommées, progression obligatoire — règle projet) :
 *   mapping   — charge postal_code_commune (~35k lignes, paginé par 5 000)
 *   fetch     — WFS public Atmo (sans creds) ; repli provider pour le pollen
 *               (API authentifiée ou mock selon ATMO_PROVIDER)
 *   aggregate — MAX des communes par code postal (conservateur zones à risque)
 *   insert    — upsert par lots de 50 (contrainte Supabase Nano)
 *   purge     — supprime les dates < J-2
 *
 * Déclenchée par le cron Inngest `civic-daily-ingest` et par
 * POST /api/admin/civic-ingest (NDJSON streaming).
 */
import { createAdminClient } from '@/lib/auth';
import { getProvider } from './provider';
import { fetchAtmoBulkWfs, fetchPollenBulkWfs } from './wfs-civic';
import type { AtmoBulkEntry, AtmoPolluant, PollenBulkEntry, PollenSpecies } from './types';

const BATCH_SIZE = 50;
/** PostgREST tronque à 5 000 lignes quel que soit le .limit() → pagination .range(). */
const MAPPING_PAGE = 5_000;

export interface CivicIngestProgress {
  step: 'mapping' | 'fetch' | 'aggregate' | 'insert' | 'purge' | 'done';
  dataset?: 'pollen' | 'atmo';
  message: string;
  current?: number;
  total?: number;
}

export interface CivicDatasetSummary {
  date: string;
  source: string;
  communes_with_data: number;
  cps_written: number;
}

export interface CivicIngestSummary {
  communes_mapping: number;
  pollen: CivicDatasetSummary | { error: string };
  atmo: CivicDatasetSummary | { error: string };
}

export interface PollenCpRow {
  date_ech: string;
  code_postal: string;
  indice_global: number;
  ambroisie: number;
  armoise: number;
  aulne: number;
  bouleau: number;
  graminees: number;
  olivier: number;
  conc_ambroisie: number;
  conc_armoise: number;
  conc_aulne: number;
  conc_bouleau: number;
  conc_graminees: number;
  conc_olivier: number;
  alerte: boolean;
  nb_communes: number;
}

export interface AtmoCpRow {
  date_ech: string;
  code_postal: string;
  indice_global: number;
  no2: number;
  o3: number;
  pm10: number;
  pm25: number;
  so2: number;
  nb_communes: number;
}

const SPECIES: PollenSpecies[] = ['ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'];
const POLLUANTS: AtmoPolluant[] = ['no2', 'o3', 'pm10', 'pm25', 'so2'];

type Mapping = Array<{ code_postal: string; code_commune: string }>;

/**
 * Agrège les niveaux pollen communes → codes postaux (MAX par espèce et sur
 * l'indice global). Pure — testée unitairement.
 */
export function aggregatePollenByCp(
  mapping: Mapping,
  byCommune: Map<string, PollenBulkEntry>,
  dateEch: string,
): PollenCpRow[] {
  const byCp = new Map<string, PollenCpRow>();
  for (const { code_postal, code_commune } of mapping) {
    const entry = byCommune.get(code_commune.toUpperCase());
    if (!entry) continue;
    let row = byCp.get(code_postal);
    if (!row) {
      row = {
        date_ech: dateEch,
        code_postal,
        indice_global: 0,
        ambroisie: 0, armoise: 0, aulne: 0, bouleau: 0, graminees: 0, olivier: 0,
        conc_ambroisie: 0, conc_armoise: 0, conc_aulne: 0, conc_bouleau: 0, conc_graminees: 0, conc_olivier: 0,
        alerte: false,
        nb_communes: 0,
      };
      byCp.set(code_postal, row);
    }
    row.nb_communes++;
    if (entry.indice_global > row.indice_global) row.indice_global = entry.indice_global;
    if (entry.alerte) row.alerte = true;
    for (const sp of SPECIES) {
      if (entry.especes[sp] > row[sp]) row[sp] = entry.especes[sp];
      const concKey = `conc_${sp}` as keyof PollenCpRow;
      const conc = entry.concentrations[sp];
      if (conc > (row[concKey] as number)) (row[concKey] as number) = conc;
    }
  }
  return [...byCp.values()];
}

/**
 * Agrège les niveaux ATMO communes → codes postaux (MAX par polluant et sur
 * l'indice global). Pure — testée unitairement.
 */
export function aggregateAtmoByCp(
  mapping: Mapping,
  byCommune: Map<string, AtmoBulkEntry>,
  dateEch: string,
): AtmoCpRow[] {
  const byCp = new Map<string, AtmoCpRow>();
  for (const { code_postal, code_commune } of mapping) {
    const entry = byCommune.get(code_commune.toUpperCase());
    if (!entry) continue;
    let row = byCp.get(code_postal);
    if (!row) {
      row = {
        date_ech: dateEch,
        code_postal,
        indice_global: 0,
        no2: 0, o3: 0, pm10: 0, pm25: 0, so2: 0,
        nb_communes: 0,
      };
      byCp.set(code_postal, row);
    }
    row.nb_communes++;
    if (entry.indice_global > row.indice_global) row.indice_global = entry.indice_global;
    for (const pol of POLLUANTS) {
      if (entry.polluants[pol] > row[pol]) row[pol] = entry.polluants[pol];
    }
  }
  return [...byCp.values()];
}

async function loadMapping(
  supabase: ReturnType<typeof createAdminClient>,
  emit: (p: CivicIngestProgress) => void,
): Promise<Mapping> {
  emit({ step: 'mapping', message: 'Chargement du référentiel codes postaux ↔ communes…' });
  const mapping: Mapping = [];
  for (let offset = 0; ; offset += MAPPING_PAGE) {
    const { data: page, error } = await supabase
      .from('postal_code_commune')
      .select('code_postal, code_commune')
      .order('code_postal')
      .range(offset, offset + MAPPING_PAGE - 1);
    if (error) throw new Error(`mapping_failed:${error.message}`);
    if (page?.length) mapping.push(...page);
    emit({ step: 'mapping', message: `${mapping.length} liaisons chargées…`, current: mapping.length });
    if (!page || page.length < MAPPING_PAGE) break;
  }
  if (!mapping.length) throw new Error('mapping_failed:empty');
  return mapping;
}

async function upsertRows<T extends { code_postal: string }>(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'pollen_map_daily' | 'atmo_map_daily',
  dataset: 'pollen' | 'atmo',
  rows: T[],
  emit: (p: CivicIngestProgress) => void,
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'date_ech,code_postal' });
    if (error) throw new Error(`insert_failed:${table}:${error.message}`);
    const done = Math.min(i + BATCH_SIZE, rows.length);
    emit({
      step: 'insert',
      dataset,
      message: `${dataset === 'pollen' ? 'Pollen' : 'Qualité de l’air'} : ${done}/${rows.length} codes postaux insérés`,
      current: done,
      total: rows.length,
    });
  }
}

async function purgeOld(
  supabase: ReturnType<typeof createAdminClient>,
  table: 'pollen_map_daily' | 'atmo_map_daily',
  emit: (p: CivicIngestProgress) => void,
): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2);
  const { error } = await supabase.from(table).delete().lt('date_ech', cutoff.toISOString().slice(0, 10));
  if (error) {
    // Non bloquant — la donnée du jour est en place
    emit({ step: 'purge', message: `Purge ${table} en échec (${error.message}) — non bloquant` });
  }
}

async function ingestPollen(
  supabase: ReturnType<typeof createAdminClient>,
  mapping: Mapping,
  communeCodes: string[],
  emit: (p: CivicIngestProgress) => void,
): Promise<CivicDatasetSummary> {
  const log = (message: string) => emit({ step: 'fetch', dataset: 'pollen', message });
  let byCommune: Map<string, PollenBulkEntry> | null = null;
  let dateEch = new Date().toISOString().slice(0, 10);
  let source = 'wfs-public';

  const wfs = await fetchPollenBulkWfs(log);
  if (wfs) {
    byCommune = wfs.byCommune;
    dateEch = wfs.date; // date réelle de la donnée (peut être J-1 tôt le matin)
  } else {
    const provider = getProvider();
    if (provider.fetchPollenBulk) {
      source = provider.name;
      log(`Repli provider (${provider.name})…`);
      byCommune = await provider.fetchPollenBulk(communeCodes, log);
    }
  }
  if (!byCommune || byCommune.size === 0) throw new Error('bulk_unavailable:pollen');

  emit({ step: 'aggregate', dataset: 'pollen', message: 'Pollen : agrégation par code postal…' });
  const rows = aggregatePollenByCp(mapping, byCommune, dateEch);
  await upsertRows(supabase, 'pollen_map_daily', 'pollen', rows, emit);
  await purgeOld(supabase, 'pollen_map_daily', emit);
  return { date: dateEch, source, communes_with_data: byCommune.size, cps_written: rows.length };
}

async function ingestAtmo(
  supabase: ReturnType<typeof createAdminClient>,
  mapping: Mapping,
  emit: (p: CivicIngestProgress) => void,
): Promise<CivicDatasetSummary> {
  const log = (message: string) => emit({ step: 'fetch', dataset: 'atmo', message });
  // Pas de repli authentifié pour l'air : le WFS public est la seule source bulk
  const wfs = await fetchAtmoBulkWfs(log);
  if (!wfs || wfs.byCommune.size === 0) throw new Error('bulk_unavailable:atmo');

  emit({ step: 'aggregate', dataset: 'atmo', message: 'Qualité de l’air : agrégation par code postal…' });
  const rows = aggregateAtmoByCp(mapping, wfs.byCommune, wfs.date);
  await upsertRows(supabase, 'atmo_map_daily', 'atmo', rows, emit);
  await purgeOld(supabase, 'atmo_map_daily', emit);
  return { date: wfs.date, source: 'wfs-public', communes_with_data: wfs.byCommune.size, cps_written: rows.length };
}

/**
 * Ingestion complète pollen + qualité de l'air. Un échec sur un dataset ne
 * bloque pas l'autre — le résumé porte l'erreur par dataset.
 */
export async function runCivicIngest(
  onProgress?: (p: CivicIngestProgress) => void,
): Promise<CivicIngestSummary> {
  const emit = (p: CivicIngestProgress) => onProgress?.(p);
  const supabase = createAdminClient();

  const mapping = await loadMapping(supabase, emit);
  const communeCodes = [...new Set(mapping.map(m => m.code_commune))];
  emit({
    step: 'mapping',
    message: `${mapping.length} liaisons, ${communeCodes.length} communes`,
    current: mapping.length,
    total: mapping.length,
  });

  const summary: CivicIngestSummary = {
    communes_mapping: communeCodes.length,
    pollen: { error: 'not_run' },
    atmo: { error: 'not_run' },
  };

  try {
    summary.pollen = await ingestPollen(supabase, mapping, communeCodes, emit);
  } catch (err) {
    summary.pollen = { error: err instanceof Error ? err.message : 'unknown' };
    emit({ step: 'fetch', dataset: 'pollen', message: `Pollen en échec : ${summary.pollen.error}` });
  }
  try {
    summary.atmo = await ingestAtmo(supabase, mapping, emit);
  } catch (err) {
    summary.atmo = { error: err instanceof Error ? err.message : 'unknown' };
    emit({ step: 'fetch', dataset: 'atmo', message: `Qualité de l'air en échec : ${summary.atmo.error}` });
  }

  const parts: string[] = [];
  if ('cps_written' in summary.pollen) parts.push(`pollen ${summary.pollen.cps_written} CP (${summary.pollen.date})`);
  if ('cps_written' in summary.atmo) parts.push(`air ${summary.atmo.cps_written} CP (${summary.atmo.date})`);
  emit({ step: 'done', message: `Ingestion terminée : ${parts.join(' · ') || 'aucun dataset'}` });
  return summary;
}

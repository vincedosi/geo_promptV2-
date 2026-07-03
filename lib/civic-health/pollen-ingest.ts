/**
 * Ingestion nationale de l'indice pollen → table pollen_map_daily.
 *
 * Pipeline (étapes nommées, progression obligatoire — règle projet) :
 *   mapping   — charge postal_code_commune (~35k lignes, paginé par 5 000)
 *   fetch     — 1) WFS public Atmo (sans creds, ~35k communes en 1 appel),
 *               2) repli provider (API authentifiée ou mock selon ATMO_PROVIDER)
 *   aggregate — MAX des communes par code postal (conservateur zones à risque)
 *   insert    — upsert par lots de 50 (contrainte Supabase Nano)
 *   purge     — supprime les dates < J-2
 *
 * Déclenchée par le cron Inngest `pollen-daily-ingest` et par
 * POST /api/admin/pollen-ingest (NDJSON streaming).
 */
import { createAdminClient } from '@/lib/auth';
import { getProvider } from './provider';
import { fetchPollenBulkWfs } from './wfs-pollen';
import type { PollenBulkEntry, PollenSpecies } from './types';

const BATCH_SIZE = 50;

export interface PollenIngestProgress {
  step: 'mapping' | 'fetch' | 'aggregate' | 'insert' | 'purge' | 'done';
  message: string;
  current?: number;
  total?: number;
}

export interface PollenIngestSummary {
  date: string;
  provider: string;
  communes_mapping: number;
  communes_with_data: number;
  cps_written: number;
  batches: number;
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
  nb_communes: number;
}

const SPECIES: PollenSpecies[] = ['ambroisie', 'armoise', 'aulne', 'bouleau', 'graminees', 'olivier'];

/**
 * Agrège les niveaux communes → codes postaux (MAX par espèce et sur l'indice
 * global). Pure — testée unitairement.
 */
export function aggregatePollenByCp(
  mapping: Array<{ code_postal: string; code_commune: string }>,
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
        nb_communes: 0,
      };
      byCp.set(code_postal, row);
    }
    row.nb_communes++;
    if (entry.indice_global > row.indice_global) row.indice_global = entry.indice_global;
    for (const sp of SPECIES) {
      if (entry.especes[sp] > row[sp]) row[sp] = entry.especes[sp];
    }
  }
  return [...byCp.values()];
}

export async function runPollenIngest(
  onProgress?: (p: PollenIngestProgress) => void,
): Promise<PollenIngestSummary> {
  const emit = (p: PollenIngestProgress) => onProgress?.(p);
  const supabase = createAdminClient();
  const provider = getProvider();

  // 1. Mapping CP ↔ commune (référentiel La Poste ~35k lignes). PostgREST
  // tronque à 5000 lignes quel que soit le .limit() → pagination .range()
  // obligatoire (vérifié : un .limit(50000) ne renvoie que 5000 lignes).
  emit({ step: 'mapping', message: 'Chargement du référentiel codes postaux ↔ communes…' });
  const PAGE = 5_000;
  const mapping: Array<{ code_postal: string; code_commune: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data: page, error: mapErr } = await supabase
      .from('postal_code_commune')
      .select('code_postal, code_commune')
      .order('code_postal')
      .range(offset, offset + PAGE - 1);
    if (mapErr) throw new Error(`mapping_failed:${mapErr.message}`);
    if (page?.length) mapping.push(...page);
    emit({ step: 'mapping', message: `${mapping.length} liaisons chargées…`, current: mapping.length });
    if (!page || page.length < PAGE) break;
  }
  if (!mapping.length) {
    throw new Error('mapping_failed:empty');
  }
  const communeCodes = [...new Set(mapping.map(m => m.code_commune))];
  emit({
    step: 'mapping',
    message: `${mapping.length} liaisons, ${communeCodes.length} communes`,
    current: mapping.length,
    total: mapping.length,
  });

  // 2. Bulk : WFS public d'abord (données réelles, zéro credential), puis
  // repli sur le provider configuré (API authentifiée ou mock)
  emit({ step: 'fetch', message: 'Récupération bulk — WFS public Atmo…' });
  let byCommune: Map<string, PollenBulkEntry> | null = null;
  let dateEch = new Date().toISOString().slice(0, 10);
  let source = 'wfs-public';

  const wfs = await fetchPollenBulkWfs(message => emit({ step: 'fetch', message }));
  if (wfs) {
    byCommune = wfs.byCommune;
    dateEch = wfs.date; // date réelle de la donnée (peut être J-1 tôt le matin)
  } else if (provider.fetchPollenBulk) {
    source = provider.name;
    emit({ step: 'fetch', message: `Repli provider (${provider.name})…` });
    byCommune = await provider.fetchPollenBulk(communeCodes, message =>
      emit({ step: 'fetch', message }),
    );
  }
  if (!byCommune || byCommune.size === 0) {
    throw new Error('bulk_unavailable');
  }
  emit({ step: 'fetch', message: `${byCommune.size} communes avec donnée pollen (source : ${source})`, current: byCommune.size });

  // 3. Agrégation par code postal
  emit({ step: 'aggregate', message: 'Agrégation par code postal (max des communes)…' });
  const rows = aggregatePollenByCp(mapping, byCommune, dateEch);
  emit({ step: 'aggregate', message: `${rows.length} codes postaux`, current: rows.length, total: rows.length });

  // 4. Upsert par lots de 50
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('pollen_map_daily')
      .upsert(batch, { onConflict: 'date_ech,code_postal' });
    if (error) throw new Error(`insert_failed:${error.message}`);
    const done = Math.min(i + BATCH_SIZE, rows.length);
    emit({
      step: 'insert',
      message: `${done}/${rows.length} codes postaux insérés`,
      current: done,
      total: rows.length,
    });
  }

  // 5. Purge J-2
  emit({ step: 'purge', message: 'Purge des dates antérieures à J-2…' });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 2);
  const { error: purgeErr } = await supabase
    .from('pollen_map_daily')
    .delete()
    .lt('date_ech', cutoff.toISOString().slice(0, 10));
  if (purgeErr) {
    // Non bloquant — la donnée du jour est en place
    emit({ step: 'purge', message: `Purge en échec (${purgeErr.message}) — non bloquant` });
  }

  const summary: PollenIngestSummary = {
    date: dateEch,
    provider: source,
    communes_mapping: communeCodes.length,
    communes_with_data: byCommune.size,
    cps_written: rows.length,
    batches: totalBatches,
  };
  emit({ step: 'done', message: `Ingestion terminée : ${rows.length} CP pour le ${dateEch}` });
  return summary;
}

/**
 * MAGELIAN — Chargement des mappings DSP depuis Supabase + cache mémoire.
 *
 * Pattern Nano-friendly : 1 round-trip DB par DSP par requête HTTP. Cache
 * process-local TTL 5 minutes pour éviter d'éclater les IOPS Supabase Nano
 * sur des imports qui font des centaines de hits.
 *
 * L'invalidation explicite est exposée via `invalidateMappingsCache()`
 * — appelable depuis un endpoint admin si quelqu'un INSERT manuellement
 * dans `dsp_source_mappings` et veut voir l'effet immédiat.
 */

import { createAdminClient } from '@/lib/auth';
import { NoMappingsFoundError, type SourceMapping } from './types';

const TTL_MS = 5 * 60 * 1000; // 5 minutes — cf CLAUDE.md (cache useRef avant tout fetch)

interface CacheEntry {
  mappings: SourceMapping[];
  fetchedAt: number;
}

const mappingsCache = new Map<string, CacheEntry>();
let availableDspsCache: { list: string[]; fetchedAt: number } | null = null;

interface MappingRow {
  id: string;
  dsp_source: string;
  source_column: string;
  target_field: string;
  target_location: 'core' | 'metrics' | 'dimension';
  data_type: 'int' | 'bigint' | 'numeric' | 'text' | 'date' | 'timestamp';
  transform: string | null;
  is_required: boolean;
  display_order: number;
  notes: string | null;
}

function rowToMapping(r: MappingRow): SourceMapping {
  return {
    id: r.id,
    dspSource: r.dsp_source,
    sourceColumn: r.source_column,
    targetField: r.target_field,
    targetLocation: r.target_location,
    dataType: r.data_type,
    transform: r.transform,
    isRequired: r.is_required,
    displayOrder: r.display_order,
    notes: r.notes,
  };
}

/**
 * Retourne tous les mappings configurés pour un DSP donné, ordonnés par
 * `display_order`. Lève `NoMappingsFoundError` si la table ne contient
 * aucune ligne pour ce DSP — c'est volontaire (pas de fallback silencieux).
 */
export async function loadMappings(dspSource: string): Promise<SourceMapping[]> {
  const key = dspSource.toLowerCase();
  const now = Date.now();

  const cached = mappingsCache.get(key);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.mappings;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_source_mappings')
    .select('id, dsp_source, source_column, target_field, target_location, data_type, transform, is_required, display_order, notes')
    .eq('dsp_source', key)
    .order('display_order', { ascending: true });

  if (error) {
    throw new Error(`[dsp-mapping/loader] Erreur DB : ${error.message}`);
  }

  const rows = (data ?? []) as MappingRow[];
  if (rows.length === 0) {
    throw new NoMappingsFoundError(dspSource);
  }

  const mappings = rows.map(rowToMapping);
  mappingsCache.set(key, { mappings, fetchedAt: now });
  return mappings;
}

/**
 * Liste les DSP qui ont au moins un mapping configuré. Drive le dropdown UI
 * `app/campaigns` (CampaignImportDialog). Cache 5 min.
 */
export async function listAvailableDsps(): Promise<string[]> {
  const now = Date.now();
  if (availableDspsCache && now - availableDspsCache.fetchedAt < TTL_MS) {
    return availableDspsCache.list;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('dsp_source_mappings')
    .select('dsp_source');

  if (error) {
    throw new Error(`[dsp-mapping/loader] Erreur listAvailableDsps : ${error.message}`);
  }

  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row && typeof (row as { dsp_source?: string }).dsp_source === 'string') {
      set.add((row as { dsp_source: string }).dsp_source);
    }
  }
  const list = Array.from(set).sort();
  availableDspsCache = { list, fetchedAt: now };
  return list;
}

/**
 * Vide le cache. À appeler après un INSERT/UPDATE/DELETE manuel sur
 * `dsp_source_mappings`. Pas exposé en route publique : usage interne /
 * tests uniquement.
 */
export function invalidateMappingsCache(): void {
  mappingsCache.clear();
  availableDspsCache = null;
}

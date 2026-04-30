'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Map as MapIcon } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import type {
  GeographyStep, ScopeType, WeightingMode, Subzone, Tier, PreviewStats as PreviewStatsT,
} from '@/lib/strategy-wizard/types';
import { TIER_LABELS_FR } from '@/lib/strategy-wizard/types';

interface Props {
  data: GeographyStep;
  onChange: (next: GeographyStep) => void;
}

interface ZoneSummary {
  id: string;
  name: string;
  source_type: string;
  feature_count_cp: number;
  feature_count_iris: number;
}

const TIERS: Tier[] = ['premium_urban', 'urban', 'suburban', 'rural'];

export function Step2Geography({ data, onChange }: Props) {
  const set = <K extends keyof GeographyStep>(k: K, v: GeographyStep[K]) =>
    onChange({ ...data, [k]: v });

  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [previewStats, setPreviewStats] = useState<PreviewStatsT | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (data.scope_type !== 'custom_zone') return;
    adminFetch('/api/custom-geo/list', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { zones: [] })
      .then(j => setZones((j.zones ?? []) as ZoneSummary[]))
      .catch(() => setZones([]));
  }, [data.scope_type]);

  // Preview stats — debounced
  useEffect(() => {
    if (data.scope_type === 'custom_zone' && !data.zone_id) {
      setPreviewStats(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await adminFetch('/api/bidding/strategies/preview-weights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope_type: data.scope_type,
            zone_id: data.zone_id ?? null,
            in_zone_weights: data.in_zone_weights,
            out_zone_weights: data.out_zone_weights,
            subzones: data.subzones,
            sample_size: 500,
          }),
        });
        if (res.ok) {
          const j = await res.json();
          setPreviewStats(j.stats);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [data.scope_type, data.zone_id, data.in_zone_weights, data.out_zone_weights, data.subzones]);

  const switchScope = (s: ScopeType) =>
    onChange({ ...data, scope_type: s, zone_id: s === 'national' ? null : data.zone_id ?? null });

  const switchMode = (m: WeightingMode) => {
    const defaults: Record<WeightingMode, { in: Record<string, unknown>; out: Record<string, unknown> }> = {
      uniform: { in: { mode: 'uniform', value: 1.5 }, out: { mode: 'uniform', value: 0.7 } },
      by_tier: { in: { mode: 'by_tier', values: { premium_urban: 2.0, urban: 1.5, suburban: 1.0, rural: 0.8 } }, out: { mode: 'uniform', value: 0.7 } },
      by_subzone: { in: { mode: 'by_subzone', value: 1.0 }, out: { mode: 'uniform', value: 0.7 } },
      by_cp_csv: { in: { mode: 'by_cp_csv', values: {} }, out: { mode: 'uniform', value: 0.7 } },
    };
    onChange({ ...data, weighting_mode: m, in_zone_weights: defaults[m].in, out_zone_weights: defaults[m].out });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      <div className="flex flex-col gap-6 max-w-3xl">
        <Section title="1. Périmètre géographique">
          <div className="flex gap-2">
            {(['national', 'custom_zone'] as ScopeType[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => switchScope(s)}
                className={pillCls(data.scope_type === s)}
              >
                {s === 'national' ? 'National (toute la France)' : 'Zone custom'}
              </button>
            ))}
          </div>

          {data.scope_type === 'custom_zone' && (
            <div className="mt-3">
              <label className="block text-[11px] text-[#666] mb-1">Choix de la zone</label>
              <select
                className={selectCls}
                value={data.zone_id ?? ''}
                onChange={(e) => set('zone_id', e.target.value || null)}
              >
                <option value="">— Sélectionner —</option>
                {(zones ?? []).map(z => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.source_type}, {z.feature_count_cp} CPs / {z.feature_count_iris} IRIS)
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#666] mt-2">
                Pour créer une nouvelle zone, allez dans Module Carte → Capture custom geo.
              </p>
            </div>
          )}
        </Section>

        <Section title="2. Mode de pondération">
          <div className="flex flex-wrap gap-2">
            {(['uniform', 'by_tier', 'by_subzone', 'by_cp_csv'] as WeightingMode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={pillCls(data.weighting_mode === m)}
              >
                {modeLabel(m)}
              </button>
            ))}
          </div>
        </Section>

        <Section title="3. Multipliers DANS la zone">
          {data.weighting_mode === 'uniform' && (
            <UniformInput
              value={Number((data.in_zone_weights as { value?: number }).value ?? 1.5)}
              onChange={(v) => set('in_zone_weights', { mode: 'uniform', value: v })}
              label="Multiplier dans la zone"
            />
          )}

          {data.weighting_mode === 'by_tier' && (
            <ByTierInput
              values={((data.in_zone_weights as { values?: Partial<Record<Tier, number>> }).values) ?? {}}
              onChange={(values) => set('in_zone_weights', { mode: 'by_tier', values })}
            />
          )}

          {data.weighting_mode === 'by_subzone' && (
            <BySubzoneInput
              subzones={data.subzones ?? []}
              onChange={(subzones) => set('subzones', subzones)}
              fallbackValue={Number((data.in_zone_weights as { value?: number }).value ?? 1.0)}
              onFallbackChange={(v) => set('in_zone_weights', { mode: 'by_subzone', value: v })}
            />
          )}

          {data.weighting_mode === 'by_cp_csv' && (
            <CSVUploadInput
              values={((data.in_zone_weights as { values?: Record<string, number> }).values) ?? {}}
              onChange={(values) => set('in_zone_weights', { mode: 'by_cp_csv', values })}
            />
          )}
        </Section>

        <Section title="4. Multipliers HORS de la zone">
          <OutZoneEditor
            value={data.out_zone_weights}
            onChange={(v) => set('out_zone_weights', v)}
          />
        </Section>
      </div>

      <aside className="border-l border-[#1a1a1a] lg:pl-6 lg:sticky lg:top-2 lg:self-start">
        <PreviewStats stats={previewStats} loading={previewLoading} />
      </aside>
    </div>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12px] font-medium text-[#f0f0f0] mb-3">
        <span className="h-1.5 w-1.5 rounded-full bg-[#4ecdc4]" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function modeLabel(m: WeightingMode): string {
  if (m === 'uniform') return 'Uniforme';
  if (m === 'by_tier') return 'Par tier';
  if (m === 'by_subzone') return 'Par sous-zone';
  return 'CSV par CP';
}

function UniformInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex flex-col gap-1.5 max-w-xs">
      <span className="text-[11px] text-[#666]">{label}</span>
      <input
        type="number"
        min={0}
        max={5}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={inputCls}
      />
      <span className="text-[11px] text-[#666]">Range : 0 - 5</span>
    </div>
  );
}

function ByTierInput({ values, onChange }: { values: Partial<Record<Tier, number>>; onChange: (v: Partial<Record<Tier, number>>) => void }) {
  return (
    <table className="w-full max-w-xl">
      <tbody>
        {TIERS.map(t => (
          <tr key={t} className="border-b border-[#1a1a1a]">
            <td className="py-2 text-xs text-[#a0a0a0]">{TIER_LABELS_FR[t]}</td>
            <td className="py-2 w-24 text-right">
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={values[t] ?? 1.0}
                onChange={(e) => onChange({ ...values, [t]: parseFloat(e.target.value) || 0 })}
                className={inputCls + ' text-right'}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BySubzoneInput({ subzones, onChange, fallbackValue, onFallbackChange }: {
  subzones: Subzone[];
  onChange: (s: Subzone[]) => void;
  fallbackValue: number;
  onFallbackChange: (v: number) => void;
}) {
  const add = () => onChange([...subzones, { name: '', postal_codes: [], multiplier: 1.0 }]);
  const update = (i: number, patch: Partial<Subzone>) =>
    onChange(subzones.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(subzones.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-3">
      {subzones.map((sz, i) => (
        <div key={i} className="flex items-center gap-2 border border-[#1a1a1a] rounded-md p-2 bg-[#0a0a0a]">
          <input
            type="text"
            placeholder="Nom de la sous-zone"
            value={sz.name}
            onChange={(e) => update(i, { name: e.target.value })}
            className={inputCls + ' flex-1'}
          />
          <input
            type="text"
            placeholder="CPs (CSV : 75001,75002,...)"
            value={sz.postal_codes.join(',')}
            onChange={(e) => update(i, { postal_codes: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            className={inputCls + ' flex-[2]'}
          />
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={sz.multiplier}
            onChange={(e) => update(i, { multiplier: parseFloat(e.target.value) || 0 })}
            className={inputCls + ' w-20'}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="p-2 text-[#666] hover:text-[#ff5757]"
            aria-label="supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 text-xs text-[#4ecdc4] hover:text-[#3dbdb5] py-2"
      >
        <Plus className="h-4 w-4" /> Ajouter une sous-zone
      </button>

      <div className="border-t border-[#1a1a1a] pt-3 mt-2">
        <UniformInput
          value={fallbackValue}
          onChange={onFallbackChange}
          label="Multiplier des CPs non assignés à une sous-zone"
        />
      </div>
    </div>
  );
}

function CSVUploadInput({ values, onChange }: { values: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (f: File) => {
    setError(null);
    const text = await f.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      setError('CSV vide ou sans header.');
      return;
    }
    const next: Record<string, number> = {};
    let bad = 0;
    for (let i = 1; i < lines.length; i++) {
      const [cp, mul] = lines[i].split(/[,;]/).map(s => s.trim());
      const m = parseFloat(mul);
      if (cp && !Number.isNaN(m)) next[cp] = Math.max(0, Math.min(5, m));
      else bad++;
    }
    onChange(next);
    if (bad > 0) setError(`${bad} ligne(s) ignorée(s) (parsing échoué).`);
  };

  const count = Object.keys(values).length;

  return (
    <div className="flex flex-col gap-2 max-w-xl">
      <label className="flex items-center gap-2 cursor-pointer">
        <span className="px-3 py-2 rounded-md border border-[#1a1a1a] bg-[#0a0a0a] text-xs text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0] flex items-center gap-2">
          <Upload className="h-4 w-4" /> Uploader un CSV
        </span>
        <input
          type="file"
          accept=".csv,.txt"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
        />
        {count > 0 && <span className="text-[11px] text-[#a0a0a0]">{count} CPs chargés</span>}
      </label>
      <p className="text-[11px] text-[#666]">
        Format : <code>postal_code,multiplier</code> (header obligatoire). Ex : <code>75001,2.5</code>
      </p>
      {error && <p className="text-[11px] text-[#ff5757]">{error}</p>}
    </div>
  );
}

function OutZoneEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const mode = (value.mode as string) ?? 'uniform';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange({ mode: 'uniform', value: 0.7 })} className={pillCls(mode === 'uniform')}>Réduction uniforme</button>
        <button type="button" onClick={() => onChange({ mode: 'by_tier', values: { premium_urban: 1.0, urban: 0.8, suburban: 0.6, rural: 0.4 } })} className={pillCls(mode === 'by_tier')}>Par tier</button>
        <button type="button" onClick={() => onChange({ mode: 'exclusion' })} className={pillCls(mode === 'exclusion')}>Exclusion totale (×0)</button>
      </div>

      {mode === 'uniform' && (
        <UniformInput
          value={Number(value.value ?? 0.7)}
          onChange={(v) => onChange({ mode: 'uniform', value: v })}
          label="Multiplier hors de la zone"
        />
      )}
      {mode === 'by_tier' && (
        <ByTierInput
          values={(value.values as Partial<Record<Tier, number>>) ?? {}}
          onChange={(values) => onChange({ mode: 'by_tier', values })}
        />
      )}
      {mode === 'exclusion' && (
        <p className="text-xs text-[#a0a0a0]">Aucune dépense hors de la zone (multiplier ×0).</p>
      )}
    </div>
  );
}

function PreviewStats({ stats, loading }: { stats: PreviewStatsT | null; loading: boolean }) {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-md p-4">
      <h4 className="flex items-center gap-2 text-[12px] font-medium text-[#f0f0f0] mb-3">
        <MapIcon className="h-4 w-4 text-[#4ecdc4]" /> Aperçu
      </h4>
      {loading && <p className="text-[11px] text-[#666]">calcul…</p>}
      {!loading && !stats && <p className="text-[11px] text-[#666]">Sélectionnez une zone pour voir l'aperçu.</p>}
      {!loading && stats && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] font-mono">
          <KV label="CPs in-zone" value={stats.n_in_zone.toLocaleString('fr-FR')} />
          <KV label="CPs out-zone" value={stats.n_out_zone.toLocaleString('fr-FR')} />
          <KV label="Exclus (×0)" value={stats.n_excluded.toLocaleString('fr-FR')} />
          <KV label="Échantillon" value={stats.n_total_sampled.toLocaleString('fr-FR')} />
          <KV label="Mult. moyen IN" value={stats.avg_multiplier_in.toFixed(2)} />
          <KV label="Mult. moyen OUT" value={stats.avg_multiplier_out.toFixed(2)} />
          <KV label="Budget IN %" value={stats.budget_share_in_pct.toFixed(1) + '%'} />
          <KV label="Budget OUT %" value={stats.budget_share_out_pct.toFixed(1) + '%'} />
        </dl>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[#666]">{label}</dt>
      <dd className="text-[#a0a0a0] text-right">{value}</dd>
    </>
  );
}

const inputCls = 'bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-1.5 text-xs text-[#f0f0f0] placeholder:text-[#666] focus:outline-none focus:border-[rgba(78,205,196,0.5)]';
const selectCls = 'w-full bg-[#111] border border-[#1a1a1a] rounded-md px-3 py-2 text-sm text-[#f0f0f0] focus:outline-none focus:border-[rgba(78,205,196,0.5)]';

function pillCls(active: boolean) {
  return `px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
    active
      ? 'border-[rgba(78,205,196,0.5)] bg-[#111] text-[#f0f0f0]'
      : 'border-[#1a1a1a] bg-[#0a0a0a] text-[#a0a0a0] hover:border-[#333] hover:text-[#f0f0f0]'
  }`;
}

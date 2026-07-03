'use client';

/**
 * ZoneMediaPlanPanel — plan média sur les zones custom affichées sur la carte.
 *
 * S'ouvre à droite quand ≥ 1 zone custom est affichée (ZonesOverlay). Une ligne
 * par item (les 4 CIRFA d'une zone battle), repli sur la zone entière sinon.
 * Paramètres : budget (€), CPM (€), cible (âge / ménages / logement social).
 *
 * Colonnes : % du total · % France (RPC totaux nationaux) · Volume cible ·
 * Impressions (répartition × budget/CPM×1000) · Répétition (impressions ÷
 * audience — nb de vues/personne) · Coût/1000 sur cible · Répartition % éditable
 * (auto-normalisée à 100, prorata par défaut). Calculs 100 % client.
 *
 * Rattachable à une campagne DSP (persistance geo_strategy.media_plan),
 * export CSV du tableau, exports DSP pondérés (DV360 / TikTok).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, FileDown, Music2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { downloadZoneExport, triggerBlobDownload } from '@/lib/custom-geo/download-export';
import { toSlug } from '@/lib/custom-geo/slug';
import { normalizeShares, proportionalShares } from '@/lib/custom-geo/media-plan';
import { CIBLE_GROUPS, CIBLE_UNIT, CIBLE_LABEL, type CibleKey } from '@/lib/custom-geo/cibles';
import type { AudienceStats, CustomGeoZoneFull } from '@/types/custom-geo';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

/** Largeur du panneau (source unique — le décalage des boutons flottants de la carte s'y aligne). */
export const PANEL_WIDTH = 600;

export type { CibleKey } from '@/lib/custom-geo/cibles';

interface ZoneRef { id: string; name: string; }

/** Valeurs d'audience d'une ligne, à plat par clé de cible. */
type RowValues = Partial<Record<CibleKey, number>>;

interface ZoneRow {
  /** zoneId seul (repli zone entière) ou `zoneId:poiId` (item). */
  id: string;
  name: string;
  values: RowValues | null;
}

interface ZoneItemStats {
  poi_id: string;
  poi_name: string;
  values: RowValues;
}

function cibleVolume(values: RowValues | null, cible: CibleKey): number | null {
  if (!values) return null;
  return values[cible] ?? null;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

interface Props {
  zones: ZoneRef[];
  topOffset: number;
  onClose: () => void;
}

export function ZoneMediaPlanPanel({ zones, topOffset, onClose }: Props) {
  const [rows, setRows] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [nationalTotals, setNationalTotals] = useState<Record<string, number> | null>(null);

  const [budget, setBudget] = useState('');
  const [cpm, setCpm] = useState('');
  const [cible, setCible] = useState<CibleKey>('total');
  // Répartition % par zone — null tant que l'utilisateur n'a pas touché
  // (défaut : prorata du volume cible, recalculé quand la cible change)
  const [repartition, setRepartition] = useState<Record<string, number> | null>(null);

  // Rattachement à une campagne DSP (persistance dans geo_strategy)
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string; dsp_source: string; has_plan: boolean }>>([]);
  const [campaignId, setCampaignId] = useState('');
  const [saveState, setSaveState] = useState<{ saving: boolean; savedAt: string | null; error: string | null }>({ saving: false, savedAt: null, error: null });

  // ── Chargement : items de chaque zone (les CIRFA d'une zone battle…),
  // repli sur l'audience globale de la zone si elle n'est pas décomposable.
  // Le premier appel par zone peut déclencher le calcul serveur (~10 s).
  // Cache par zone.id : ajouter/retirer une zone ne refetch QUE les nouvelles
  // (Nano — évite N SELECT superflus à chaque modif de la liste affichée).
  const zoneRowsCache = useRef<Map<string, ZoneRow[]>>(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!zones.length) { setRows([]); return; }
    // Recompose les lignes depuis le cache dans l'ordre d'affichage des zones.
    const recompose = () => zones.flatMap(z => zoneRowsCache.current.get(z.id) ?? []);
    const missing = zones.filter(z => !zoneRowsCache.current.has(z.id));
    if (!missing.length) {
      setRows(recompose()); // tout en cache → sans I/O
      return;
    }
    setLoading(true);
    (async () => {
      // Séquentiel par lots de 3 — règle projet : jamais plus de 3 appels parallèles
      for (let i = 0; i < missing.length; i += 3) {
        const batch = missing.slice(i, i + 3);
        const fetched = await Promise.all(batch.map(async (z): Promise<[string, ZoneRow[]]> => {
          try {
            const res = await adminFetch(`/api/custom-geo/${z.id}/items-audience`);
            if (res.ok) {
              const payload = await res.json() as { items: ZoneItemStats[] | null };
              if (payload.items?.length) {
                return [z.id, payload.items.map(it => ({
                  id: `${z.id}:${it.poi_id}`,
                  name: it.poi_name,
                  values: it.values ?? null,
                }))];
              }
            }
            // Repli : zone entière (audience_stats de la capture) → aplati en RowValues
            const full = await adminFetch(`/api/custom-geo/${z.id}`).then(r => (r.ok ? r.json() : null)) as CustomGeoZoneFull | null;
            const stats = full?.audience_stats && 'population' in full.audience_stats
              ? (full.audience_stats as AudienceStats)
              : null;
            const values: RowValues | null = stats?.population ? {
              total: stats.population.total,
              ...stats.population.by_age,
              men: stats.menages?.total,
              men_prop: stats.menages?.proprietaires,
              men_fmp: stats.menages?.monoparentales,
              men_pauv: stats.menages?.pauvres,
              log_soc: stats.logements?.sociaux,
            } : null;
            return [z.id, [{ id: z.id, name: z.name, values }]];
          } catch {
            return [z.id, [{ id: z.id, name: z.name, values: null }]];
          }
        }));
        if (cancelled) return;
        for (const [zoneId, zoneRows] of fetched) zoneRowsCache.current.set(zoneId, zoneRows);
        setRows(recompose()); // repose au fil de l'eau les zones déjà résolues
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [zones]);

  // ── Totaux France (cache serveur 24h + cache navigateur) ─────────────────
  useEffect(() => {
    let cancelled = false;
    adminFetch('/api/custom-geo/national-totals')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j?.totals) setNationalTotals(j.totals); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Liste des campagnes de l'org (sélecteur de rattachement) ─────────────
  useEffect(() => {
    let cancelled = false;
    adminFetch('/api/custom-geo/media-plan')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled && j?.campaigns) setCampaigns(j.campaigns); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Sélection d'une campagne → préremplit budget/CPM/cible + poids stockés ─
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    setSaveState({ saving: false, savedAt: null, error: null });
    adminFetch(`/api/custom-geo/media-plan?campaign_id=${campaignId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelled || !j?.plan?.zones) return;
        const plan = j.plan as {
          budget: number | null; cpm: number | null; cible: CibleKey;
          weights: Record<string, number>; updated_at?: string;
        };
        setBudget(plan.budget != null ? String(plan.budget) : '');
        setCpm(plan.cpm != null ? String(plan.cpm) : '');
        setCible(plan.cible);
        // Poids appliqués aux lignes présentes (les autres restent au prorata)
        setRepartition(Object.keys(plan.weights ?? {}).length ? plan.weights : null);
        setSaveState({ saving: false, savedAt: plan.updated_at ?? null, error: null });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [campaignId]);

  // ── Calculs ───────────────────────────────────────────────────────────────
  const volumes = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of rows) m.set(r.id, cibleVolume(r.values, cible));
    return m;
  }, [rows, cible]);

  const totalVolume = useMemo(
    () => rows.reduce((acc, r) => acc + (volumes.get(r.id) ?? 0), 0),
    [rows, volumes],
  );

  /** Répartition par défaut : prorata du volume cible (zones sans stats → 0). */
  const defaultRepartition = useMemo(
    () => proportionalShares(rows.map(r => ({ id: r.id, volume: volumes.get(r.id) ?? null }))),
    [rows, volumes],
  );

  const activeRepartition = repartition ?? defaultRepartition;

  // La cible ou la liste de zones change → on repart du prorata
  useEffect(() => { setRepartition(null); }, [cible, zones]);

  /** Modifie la part d'une zone ; les autres se réajustent proportionnellement. */
  const setZoneShare = useCallback((zoneId: string, valueRaw: number) => {
    const current = repartition ?? defaultRepartition;
    setRepartition(normalizeShares(current, zoneId, valueRaw, rows.map(r => r.id)));
  }, [repartition, defaultRepartition, rows]);

  const budgetNum = parseFloat(budget.replace(',', '.'));
  const cpmNum = parseFloat(cpm.replace(',', '.'));
  const totalImpressions = budgetNum > 0 && cpmNum > 0 ? (budgetNum / cpmNum) * 1000 : null;
  const franceTotal = nationalTotals?.[cible] ?? null;

  // Métriques dérivées par ligne — réutilisées par le tableau ET l'export CSV.
  // frequence  = impressions ÷ audience cible (répétition : nb de vues/personne)
  // costPerMille = budget de la ligne ÷ (audience cible ÷ 1000) — coût réel/1000 sur cible
  const rowMetrics = useMemo(() => {
    const m = new Map<string, {
      vol: number | null; share: number; impressions: number | null;
      pctZones: number | null; pctFrance: number | null; frequence: number | null; costPerMille: number | null;
    }>();
    for (const r of rows) {
      const vol = volumes.get(r.id) ?? null;
      const share = activeRepartition[r.id] ?? 0;
      const impressions = totalImpressions != null ? (share / 100) * totalImpressions : null;
      const budgetRow = Number.isFinite(budgetNum) && budgetNum > 0 ? (share / 100) * budgetNum : null;
      m.set(r.id, {
        vol, share, impressions,
        pctZones: totalVolume > 0 && vol != null ? (vol / totalVolume) * 100 : null,
        pctFrance: franceTotal && vol != null ? (vol / franceTotal) * 100 : null,
        frequence: impressions != null && vol && vol > 0 ? impressions / vol : null,
        costPerMille: budgetRow != null && vol && vol > 0 ? budgetRow / (vol / 1000) : null,
      });
    }
    return m;
  }, [rows, volumes, activeRepartition, totalImpressions, budgetNum, totalVolume, franceTotal]);

  const fmtFreq = (n: number | null) => (n != null ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}×` : '—');
  const fmtEur = (n: number | null) => (n != null ? `${Math.round(n).toLocaleString('fr-FR')} €` : '—');

  // ── Exports DSP pondérés par la colonne répartition ───────────────────────
  const [exportState, setExportState] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const exportWeighted = useCallback(async (format: 'bidding_script' | 'tiktok_geo') => {
    setExportState({ running: true, error: null });
    try {
      // Un fichier par zone affichée ; les items de la zone portent les poids
      // du tableau (bruts, non renormalisés — les scores DSP sont relatifs)
      for (const z of zones) {
        const itemRows = rows.filter(r => r.id.startsWith(`${z.id}:`));
        if (itemRows.length) {
          const weights: Record<string, number> = {};
          for (const r of itemRows) {
            weights[r.id.slice(z.id.length + 1)] = Math.round((activeRepartition[r.id] ?? 0) * 10) / 10;
          }
          const params: Record<string, string> = { weights: JSON.stringify(weights) };
          if (format === 'tiktok_geo' && budgetNum > 0) params.budget = String(budgetNum);
          await downloadZoneExport(z.id, format, params);
        } else {
          // Zone non décomposable : export classique non pondéré
          await downloadZoneExport(z.id, format);
        }
      }
      setExportState({ running: false, error: null });
    } catch (err) {
      setExportState({ running: false, error: err instanceof Error ? err.message : 'Erreur export' });
    }
  }, [zones, rows, activeRepartition, budgetNum]);

  // ── Enregistrement du plan sur la campagne (geo_strategy) ─────────────────
  const savePlan = useCallback(async () => {
    if (!campaignId) return;
    setSaveState({ saving: true, savedAt: null, error: null });
    try {
      const res = await adminFetch('/api/custom-geo/media-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          plan: {
            zones,
            budget: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null,
            cpm: Number.isFinite(cpmNum) && cpmNum > 0 ? cpmNum : null,
            cible,
            weights: Object.fromEntries(
              rows.map(r => [r.id, Math.round((activeRepartition[r.id] ?? 0) * 10) / 10]),
            ),
          },
        }),
      });
      if (res.status === 403) throw new Error('Campagne hors de votre organisation.');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setSaveState({ saving: false, savedAt: j.plan?.updated_at ?? new Date().toISOString(), error: null });
      setCampaigns(prev => prev.map(c => (c.id === campaignId ? { ...c, has_plan: true } : c)));
    } catch (err) {
      setSaveState({ saving: false, savedAt: null, error: err instanceof Error ? err.message : 'Erreur' });
    }
  }, [campaignId, zones, budgetNum, cpmNum, cible, rows, activeRepartition]);

  // ── Export CSV du tableau (partage client/collègue) ───────────────────────
  const exportTableCsv = useCallback(() => {
    const sep = ';'; // séparateur FR (Excel)
    const esc = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const num = (n: number | null, d = 0) => (n == null ? '' : n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
    const campaignName = campaigns.find(c => c.id === campaignId)?.name ?? '';
    const meta = [
      `Plan média${campaignName ? ` — ${campaignName}` : ''}`,
      `Cible${sep}${CIBLE_LABEL[cible]} (${CIBLE_UNIT[cible]})`,
      `Budget${sep}${budgetNum > 0 ? budgetNum : ''}${sep}CPM${sep}${cpmNum > 0 ? cpmNum : ''}`,
      `Impressions totales${sep}${totalImpressions != null ? Math.round(totalImpressions) : ''}`,
      '',
    ];
    const header = ['Zone', '% total', '% France', `Volume (${CIBLE_UNIT[cible]})`, 'Impressions', 'Répétition', 'Coût/1000 cible (€)', 'Répartition %'];
    const body = rows.map(r => {
      const mm = rowMetrics.get(r.id)!;
      return [
        esc(r.name), num(mm.pctZones, 1), num(mm.pctFrance, 2), num(mm.vol),
        num(mm.impressions), num(mm.frequence, 1), num(mm.costPerMille), num(mm.share, 1),
      ].join(sep);
    });
    const totalRow = [
      'Total', totalVolume > 0 ? '100' : '', franceTotal && totalVolume > 0 ? num((totalVolume / franceTotal) * 100, 2) : '',
      num(totalVolume), num(totalImpressions), num(totalImpressions && totalVolume > 0 ? totalImpressions / totalVolume : null, 1),
      num(budgetNum > 0 && totalVolume > 0 ? budgetNum / (totalVolume / 1000) : null), '100',
    ].join(sep);

    const csv = '﻿' + [...meta, header.join(sep), ...body, totalRow].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(blob, `plan_media${campaignName ? '_' + toSlug(campaignName) : ''}.csv`);
  }, [rows, rowMetrics, campaigns, campaignId, cible, budgetNum, cpmNum, totalImpressions, totalVolume, franceTotal]);

  const detachPlan = useCallback(async () => {
    if (!campaignId) return;
    setSaveState({ saving: true, savedAt: null, error: null });
    try {
      const res = await adminFetch(`/api/custom-geo/media-plan?campaign_id=${campaignId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState({ saving: false, savedAt: null, error: null });
      setCampaigns(prev => prev.map(c => (c.id === campaignId ? { ...c, has_plan: false } : c)));
    } catch (err) {
      setSaveState({ saving: false, savedAt: null, error: err instanceof Error ? err.message : 'Erreur' });
    }
  }, [campaignId]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: 'var(--bg-level-2)',
    border: '0.5px solid var(--border-subtle)', borderRadius: 6,
    fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)', marginBottom: 4, display: 'block',
  };
  const thStyle: React.CSSProperties = {
    fontFamily: fInter, fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)',
    textAlign: 'right', padding: '6px 8px', borderBottom: '0.5px solid var(--border-default)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    fontFamily: fMono, fontSize: 11.5, color: 'var(--text-secondary)',
    textAlign: 'right', padding: '8px 8px', borderBottom: '0.5px solid var(--border-subtle)',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      position: 'fixed', top: topOffset, right: 0, bottom: 0, width: PANEL_WIDTH, zIndex: 45,
      background: 'var(--bg-surface)', borderLeft: '0.5px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand-teal)' }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: fInter }}>
          Plan média — {zones.length} zone{zones.length > 1 ? 's' : ''}
        </span>
        <button onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: 2 }}>
          <X size={15} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Rattachement campagne DSP */}
        <div>
          <label style={labelStyle}>Campagne rattachée</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={campaignId}
              onChange={e => setCampaignId(e.target.value)}
              style={{ ...inputStyle, fontFamily: fInter, cursor: 'pointer', flex: 1 }}
            >
              <option value="">— Aucune (plan non enregistré) —</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.has_plan ? '● ' : ''}{c.name} · {c.dsp_source}
                </option>
              ))}
            </select>
            <button
              onClick={savePlan}
              disabled={!campaignId || saveState.saving || loading}
              title={campaignId ? 'Enregistrer le plan sur la campagne' : 'Choisir une campagne'}
              style={{
                padding: '7px 14px', borderRadius: 6, fontFamily: fInter, fontSize: 12, fontWeight: 500,
                cursor: !campaignId || saveState.saving ? 'not-allowed' : 'pointer',
                background: !campaignId ? 'var(--bg-level-2)' : 'var(--brand-teal)',
                border: 'none', color: !campaignId ? 'var(--text-tertiary)' : '#050505',
                opacity: saveState.saving ? 0.6 : 1, whiteSpace: 'nowrap',
              }}
            >
              {saveState.saving ? '…' : 'Enregistrer'}
            </button>
          </div>
          {campaignId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span style={{ fontFamily: fMono, fontSize: 9, color: saveState.error ? 'var(--danger)' : 'var(--text-tertiary)' }}>
                {saveState.error
                  ? saveState.error
                  : saveState.savedAt
                    ? `Enregistré le ${new Date(saveState.savedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'Plan non encore enregistré'}
              </span>
              {saveState.savedAt && (
                <button onClick={detachPlan} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 9, cursor: 'pointer', textDecoration: 'underline' }}>
                  détacher
                </button>
              )}
            </div>
          )}
        </div>

        {/* Paramètres */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Budget (€)</label>
            <input value={budget} onChange={e => setBudget(e.target.value)} placeholder="50 000" inputMode="decimal" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>CPM (€)</label>
            <input value={cpm} onChange={e => setCpm(e.target.value)} placeholder="6,50" inputMode="decimal" style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Cible</label>
            <select value={cible} onChange={e => setCible(e.target.value as CibleKey)}
              style={{ ...inputStyle, fontFamily: fInter, cursor: 'pointer' }}>
              {CIBLE_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* Impressions totales */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          padding: '8px 12px', background: 'var(--bg-level-2)', borderRadius: 6,
          border: '0.5px solid var(--border-subtle)',
        }}>
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
            Impressions totales (budget ÷ CPM × 1000)
          </span>
          <span style={{ fontFamily: fMono, fontSize: 14, color: totalImpressions ? 'var(--brand-teal)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
            {totalImpressions ? fmtInt(totalImpressions) : '—'}
          </span>
        </div>

        {/* Tableau */}
        {loading ? (
          <div style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', padding: '20px 0', textAlign: 'center' }}>
            Chargement des audiences…
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Zone</th>
                  <th style={thStyle} title="Part de la ligne dans le total affiché, sur la cible">% total</th>
                  <th style={thStyle} title="Volume cible de la zone rapporté à la population France de la cible">% France</th>
                  <th style={thStyle} title={`Volume cible (${CIBLE_UNIT[cible]})`}>Volume</th>
                  <th style={thStyle} title="Répartition % × impressions totales — calculé">Impressions</th>
                  <th style={thStyle} title="Répétition : impressions ÷ audience cible (nombre de vues par personne)">Répétition</th>
                  <th style={thStyle} title="Coût pour 1000 personnes de la cible : budget de la zone ÷ (audience ÷ 1000)">€/1000</th>
                  <th style={thStyle} title="Part du budget allouée à la zone — modifiable, somme = 100 %">Répart.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const mm = rowMetrics.get(r.id)!;
                  return (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, textAlign: 'left', fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                        {r.name}
                      </td>
                      <td style={tdStyle}>{mm.pctZones != null ? fmtPct(mm.pctZones) : '—'}</td>
                      <td style={tdStyle}>{mm.pctFrance != null ? fmtPct(mm.pctFrance, 2) : '—'}</td>
                      <td style={tdStyle} title={mm.vol == null ? 'Stats d’audience non calculées pour cette zone' : undefined}>
                        {mm.vol != null ? fmtInt(mm.vol) : 'n/d'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-tertiary)' }}>
                        {mm.impressions != null ? fmtInt(mm.impressions) : '—'}
                      </td>
                      <td style={{ ...tdStyle, color: mm.frequence != null && mm.frequence > 10 ? 'var(--warning)' : 'var(--text-secondary)' }}
                          title={mm.frequence != null && mm.frequence > 10 ? 'Sur-exposition : le budget dépasse largement l’audience cible' : undefined}>
                        {fmtFreq(mm.frequence)}
                      </td>
                      <td style={tdStyle}>{fmtEur(mm.costPerMille)}</td>
                      <td style={{ ...tdStyle, padding: '4px 0 4px 8px' }}>
                        <input
                          type="number" min={0} max={100} step={0.1}
                          value={Math.round(mm.share * 10) / 10}
                          onChange={e => setZoneShare(r.id, parseFloat(e.target.value) || 0)}
                          aria-label={`Répartition ${r.name}`}
                          style={{
                            width: 58, padding: '5px 6px', textAlign: 'right',
                            background: 'var(--bg-level-2)', borderRadius: 4,
                            border: `0.5px solid ${repartition ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                            fontFamily: fMono, fontSize: 11.5, color: 'var(--text-primary)', outline: 'none',
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...tdStyle, textAlign: 'left', fontFamily: fInter, color: 'var(--text-tertiary)', borderBottom: 'none' }}>Total</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>{totalVolume > 0 ? '100 %' : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>
                    {franceTotal && totalVolume > 0 ? fmtPct((totalVolume / franceTotal) * 100, 2) : '—'}
                  </td>
                  <td style={{ ...tdStyle, borderBottom: 'none', color: 'var(--text-primary)' }}>{totalVolume > 0 ? fmtInt(totalVolume) : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none', color: 'var(--text-primary)' }}>{totalImpressions ? fmtInt(totalImpressions) : '—'}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>{fmtFreq(totalImpressions && totalVolume > 0 ? totalImpressions / totalVolume : null)}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>{fmtEur(budgetNum > 0 && totalVolume > 0 ? budgetNum / (totalVolume / 1000) : null)}</td>
                  <td style={{ ...tdStyle, borderBottom: 'none' }}>
                    {fmtPct(Object.values(activeRepartition).reduce((a, b) => a + b, 0), 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Actions tableau : reset répartition + export CSV */}
        {!loading && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {repartition && (
              <button
                onClick={() => setRepartition(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 6,
                  color: 'var(--text-secondary)', fontFamily: fInter, fontSize: 11, padding: '6px 10px', cursor: 'pointer',
                }}
              >
                <RotateCcw size={11} /> Répartir au prorata
              </button>
            )}
            <button
              onClick={exportTableCsv}
              title="Télécharger le tableau (CSV, ouvrable dans Excel)"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'none', border: '0.5px solid var(--border-default)', borderRadius: 6,
                color: 'var(--text-secondary)', fontFamily: fInter, fontSize: 11, padding: '6px 10px', cursor: 'pointer',
              }}
            >
              <FileDown size={11} /> Exporter le tableau (CSV)
            </button>
          </div>
        )}

        {/* Exports DSP — pondérés par la colonne répartition */}
        {!loading && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '0.5px solid var(--border-subtle)', paddingTop: 12 }}>
            <div style={{ fontFamily: fInter, fontSize: 10.5, color: 'var(--text-tertiary)' }}>
              Générer les fichiers DSP avec les poids de la répartition
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([
                ['bidding_script', FileDown, 'Script bidding DV360'],
                ['tiktok_geo', Music2, 'Ciblage TikTok'],
              ] as const).map(([format, Icon, label]) => (
                <button
                  key={format}
                  onClick={() => { void exportWeighted(format); }}
                  disabled={exportState.running}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'transparent', border: '0.5px solid var(--brand-teal)', borderRadius: 6,
                    color: 'var(--brand-teal)', fontFamily: fInter, fontSize: 11.5, fontWeight: 500,
                    padding: '7px 12px', cursor: exportState.running ? 'wait' : 'pointer',
                    opacity: exportState.running ? 0.6 : 1,
                    transition: 'background-color 150ms var(--ease-hover)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon size={12} strokeWidth={1.5} />
                  {exportState.running ? 'Génération…' : label}
                </button>
              ))}
            </div>
            {exportState.error && (
              <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--danger)' }}>{exportState.error}</div>
            )}
          </div>
        )}

        <div style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)', fontStyle: 'italic', lineHeight: 1.5 }}>
          Volumes cibles : carreaux INSEE 200m intersectant la zone (calculés à la capture) ·
          % France : total national carreaux 5 km · les impressions suivent la colonne répartition.
        </div>
      </div>
    </div>
  );
}

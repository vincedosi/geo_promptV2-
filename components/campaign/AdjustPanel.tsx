'use client';

/**
 * AdjustPanel — action « Ajuster » : modale compacte pour modifier une campagne
 * LANCÉE (stratégie active) sans repasser le wizard. Sections pré-remplies :
 * budgets PAR CANAL (global = somme), CPM, dates, mode, intensité, cible, canaux
 * (+ liens DV360). Diff, pas re-saisie : seul le modifié part au serveur
 * (POST /api/bidding/strategies/[id]/adjust) — raison obligatoire, récap des
 * pushes par canal (poussé / simulé / échec / ignoré) au retour.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import { resolveFinalZone } from '@/lib/campaigns/resolve-zone';
import type { ChannelRow, StoredChannels, CampaignChannels, DspLinks } from '@/lib/campaigns/channels';
import {
  INTENSITY_META, EXECUTION_MODE_META, inferIntensity, fmtEUR,
  type Intensity, type ExecutionMode,
} from '@/components/campaign/wizard/steps/types';
import {
  C, fInter, fMono, FieldBlock, NumberField, DateField, OptionRow, OptsList,
  GhostButton, PrimaryButton, Row2,
} from '@/components/campaign/wizard/steps/ui';

interface PushLine { channel: string; status: 'pushed' | 'simulated' | 'failed' | 'skipped'; detail: string }

interface PanelState {
  channelBudgets: Record<string, number>;
  forecastCpm: number | null;
  startDate: string;
  endDate: string;
  executionMode: ExecutionMode;
  intensity: Intensity;
  cibles: { id: string; name: string }[];
  channels: CampaignChannels;
  links: DspLinks;
}

const PUSH_LABEL: Record<PushLine['status'], string> = {
  pushed: 'poussé', simulated: 'simulé', failed: 'échec', skipped: 'ignoré',
};

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', background: C.elevated, border: 'none', cursor: 'pointer',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
        }}
      >
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal, flexShrink: 0 }} />
        <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontFamily: fMono, fontSize: 11, color: C.textDim }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '14px' }}>{children}</div>}
    </div>
  );
}

export function AdjustPanel({
  campaignId, strategyId, open, onClose, onApplied, initialChanges, initialReason,
}: {
  campaignId: string; strategyId: string; open: boolean;
  onClose: () => void; onApplied: () => void;
  initialChanges?: Record<string, unknown>; initialReason?: string;
}) {
  const { toast: toastApi } = useToast();
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState<PanelState | null>(null);
  const [state, setState] = useState<PanelState | null>(null);
  const [catalog, setCatalog] = useState<ChannelRow[]>([]);
  const [reason, setReason] = useState(initialReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [pushResults, setPushResults] = useState<PushLine[] | null>(null);
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  const [zonesList, setZonesList] = useState<{ id: string; name: string }[]>([]);
  // Hint budget (spec §5b) : campagnes créées avant le modèle par canal — la
  // stratégie a un total_budget global mais aucune ligne channelBudgets.
  const [strategyTotalBudget, setStrategyTotalBudget] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Capture de initialChanges à l'ouverture du panneau uniquement — pas comme
  // dépendance de l'effet de chargement ci-dessous : un appelant qui passerait
  // un littéral objet inline (nouvelle identité à chaque render parent)
  // provoquerait sinon un re-fetch des 2 appels réseau à chaque render.
  const initialChangesRef = useRef(initialChanges);
  useEffect(() => {
    if (open) initialChangesRef.current = initialChanges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus le conteneur du dialogue à l'ouverture (baseline a11y — pas de focus
  // trap complet, hors scope).
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  // Chargement initial : stratégie + canaux (2 appels), org + zones en lazy.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPushResults(null);
    (async () => {
      try {
        const [sRes, chRes] = await Promise.all([
          adminFetch(`/api/bidding/strategies/${strategyId}`, { cache: 'no-store' }),
          adminFetch(`/api/campaigns/${campaignId}/channels`, { cache: 'no-store' }),
        ]);
        if (cancelled) return;
        const s = sRes.ok ? (await sRes.json()).strategy ?? {} : {};
        const ch = chRes.ok ? await chRes.json() : { catalog: [], selected: { dsps: [], socials: [], ad_server: null } };
        const stored = (ch.selected ?? {}) as StoredChannels;
        const base: PanelState = {
          channelBudgets: { ...(stored.budgets ?? {}) },
          forecastCpm: s.forecast_cpm ?? null,
          startDate: s.start_date ? String(s.start_date).slice(0, 10) : '',
          endDate: s.end_date ? String(s.end_date).slice(0, 10) : '',
          executionMode: (s.execution_mode ?? 'auto') as ExecutionMode,
          intensity: inferIntensity(s.in_zone_weights) ?? 'marque',
          cibles: s.zone_id ? [{ id: s.zone_id, name: 'Zone de la stratégie' }] : [],
          channels: { dsps: stored.dsps ?? [], socials: stored.socials ?? [], ad_server: stored.ad_server ?? null },
          links: stored.links ?? {},
        };
        setCatalog((ch.catalog ?? []) as ChannelRow[]);
        setStrategyTotalBudget(typeof s.total_budget === 'number' ? s.total_budget : null);
        setInitial(base);
        // Pré-remplissage externe (proposition de l'agent) : merge sur l'état courant.
        const ic = initialChangesRef.current ?? {};
        setState({
          ...base,
          channelBudgets: { ...base.channelBudgets, ...((ic.channel_budgets as Record<string, number>) ?? {}) },
          forecastCpm: (ic.forecast_cpm as number | undefined) ?? base.forecastCpm,
          startDate: (ic.start_date as string | undefined) ?? base.startDate,
          endDate: (ic.end_date as string | undefined) ?? base.endDate,
          executionMode: (ic.execution_mode as ExecutionMode | undefined) ?? base.executionMode,
          intensity: (ic.intensity as Intensity | undefined) ?? base.intensity,
        });
      } catch { /* best-effort */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // initialChanges volontairement absent des deps : capturé une fois à
    // l'ouverture via initialChangesRef (voir effet ci-dessus) pour éviter un
    // re-fetch à chaque render parent si la prop est un littéral inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaignId, strategyId]);

  // Org + zones custom (pour la section Cible) — lazy, une fois le panneau ouvert.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        const org = (orgData.owner_organization_id as string | undefined) ?? null;
        if (cancelled) return;
        setOwnerOrgId(org);
        if (org) {
          const zRes = await adminFetch(`/api/custom-geo/list?org_id=${org}`, { cache: 'no-store' });
          const zData = zRes.ok ? await zRes.json() : {};
          if (!cancelled) {
            setZonesList(((zData.zones ?? []) as Array<{ id: string; name: string }>).map((z) => ({ id: z.id, name: z.name })));
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open, campaignId]);

  const labels = useMemo(() => Object.fromEntries(catalog.map((c) => [c.code, c.label])), [catalog]);
  const total = useMemo(() => {
    if (!state) return 0;
    const allowed = new Set([...state.channels.dsps, ...state.channels.socials]);
    return Object.entries(state.channelBudgets)
      .filter(([code]) => allowed.has(code))
      .reduce((s, [, v]) => s + (Number.isFinite(v) ? v : 0), 0);
  }, [state]);
  // Hint budget (spec §5b) : toutes les lignes vides mais un total_budget global > 0
  // (campagne créée avant le modèle par canal) — invite à répartir ce montant.
  const showBudgetHint = total <= 0
    && !!strategyTotalBudget && strategyTotalBudget > 0
    && !!state && Object.keys(state.channelBudgets).length === 0;

  // ── Diff : ne soumettre QUE le modifié ──────────────────────────────────────
  const diff = useMemo(() => {
    if (!initial || !state) return { changes: {} as Record<string, unknown>, labels: [] as string[] };
    const changes: Record<string, unknown> = {};
    const out: string[] = [];
    if (JSON.stringify(initial.channelBudgets) !== JSON.stringify(state.channelBudgets)) {
      changes.channel_budgets = state.channelBudgets;
      out.push(`budgets → global ${fmtEUR(total || null)}`);
    }
    if (initial.forecastCpm !== state.forecastCpm && state.forecastCpm != null) {
      changes.forecast_cpm = state.forecastCpm; out.push(`CPM ${initial.forecastCpm ?? '—'} → ${state.forecastCpm}`);
    }
    if (initial.startDate !== state.startDate && state.startDate) { changes.start_date = state.startDate; out.push(`début ${state.startDate}`); }
    if (initial.endDate !== state.endDate && state.endDate) { changes.end_date = state.endDate; out.push(`fin ${state.endDate}`); }
    if (initial.executionMode !== state.executionMode) { changes.execution_mode = state.executionMode; out.push(`mode ${EXECUTION_MODE_META[state.executionMode].title}`); }
    if (initial.intensity !== state.intensity) { changes.intensity = state.intensity; out.push(`intensité ${INTENSITY_META[state.intensity].title}`); }
    if (JSON.stringify(initial.cibles.map((c) => c.id)) !== JSON.stringify(state.cibles.map((c) => c.id))) {
      changes.__cibles = state.cibles; out.push(`cible (${state.cibles.length || 'national'})`);
    }
    if (JSON.stringify(initial.channels) !== JSON.stringify(state.channels)) { changes.channels = state.channels; out.push('canaux'); }
    return { changes, labels: out };
  }, [initial, state, total]);
  const linksChanged = !!initial && !!state && JSON.stringify(initial.links) !== JSON.stringify(state.links);
  const hasDiff = diff.labels.length > 0 || linksChanged;

  const apply = useCallback(async () => {
    if (!state || !hasDiff || reason.trim().length < 3 || submitting) return;
    setSubmitting(true);
    try {
      const { __cibles, ...changes } = diff.changes as { __cibles?: { id: string; name: string }[] } & Record<string, unknown>;
      if (__cibles) {
        const zone = await resolveFinalZone(__cibles, ownerOrgId);
        (changes as Record<string, unknown>).zone = zone;
      }
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/adjust`, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          changes,
          ...(linksChanged ? { links: state.links } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastApi.error('Ajustement impossible', data.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      setPushResults((data.pushes ?? []) as PushLine[]);
      toastApi.success('Campagne ajustée', 'Modifications enregistrées et journalisées.');
      onApplied();
    } catch (err) {
      toastApi.error('Erreur réseau', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  }, [state, hasDiff, reason, submitting, diff, linksChanged, ownerOrgId, strategyId, toastApi, onApplied]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Ajuster la campagne"
      aria-modal="true"
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !submitting) onClose(); }}
    >
      <div style={{
        width: 'min(680px, 100%)', background: C.card, border: `0.5px solid ${C.border}`,
        borderRadius: 12, overflow: 'hidden',
      }}>
        <div style={{ background: C.elevated, borderBottom: `0.5px solid ${C.border}`, padding: '13px 20px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal }} />
          <h2 style={{ fontFamily: fInter, fontSize: 14, fontWeight: 500, color: C.text, margin: 0 }}>Ajuster la campagne</h2>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Fermer"
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.textDim, fontFamily: fMono, fontSize: 16, cursor: 'pointer' }}>
            ×
          </button>
        </div>

        {loading || !state ? (
          <div style={{ padding: 24, fontFamily: fInter, fontSize: 13, color: C.textDim }}>Chargement…</div>
        ) : pushResults ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: fInter, fontSize: 13, color: C.text, fontWeight: 500 }}>Récapitulatif du push</div>
            {pushResults.length === 0 && (
              <div style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>Aucun canal à pousser.</div>
            )}
            {pushResults.map((p) => (
              <div key={p.channel} style={{ display: 'flex', gap: 10, alignItems: 'baseline', border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
                <span style={{ fontFamily: fMono, fontSize: 12, color: C.text }}>{labels[p.channel] ?? p.channel}</span>
                <span style={{
                  fontFamily: fInter, fontSize: 11, borderRadius: 4, padding: '1px 8px',
                  background: C.elevated, border: `0.5px solid ${C.borderDefault}`,
                  color: p.status === 'failed' ? 'var(--danger)' : p.status === 'pushed' ? 'var(--success)' : C.textSec,
                }}>{PUSH_LABEL[p.status]}</span>
                <span style={{ fontFamily: fInter, fontSize: 11.5, color: C.textDim, flex: 1 }}>{p.detail}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <PrimaryButton label="Fermer" onClick={onClose} />
            </div>
          </div>
        ) : (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Section title="Budget & période" defaultOpen>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...state.channels.dsps, ...state.channels.socials].map((code) => (
                  <NumberField
                    key={code}
                    label={labels[code] ?? code}
                    value={state.channelBudgets[code] ?? null}
                    onChange={(v) => setState((prev) => {
                      if (!prev) return prev;
                      const next = { ...prev.channelBudgets };
                      if (v == null) delete next[code]; else next[code] = v;
                      return { ...prev, channelBudgets: next };
                    })}
                    suffix="€" placeholder="ex. 30000" step={100} min={0}
                  />
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `0.5px solid ${C.border}`, paddingTop: 10 }}>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>Budget global (somme)</span>
                  <span style={{ fontFamily: fMono, fontSize: 15, color: C.text }}>{fmtEUR(total || null)}</span>
                </div>
                {showBudgetHint && (
                  <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                    Répartis le budget actuel ({fmtEUR(strategyTotalBudget)}) entre les canaux
                  </div>
                )}
                <Row2>
                  <NumberField label="CPM cible" value={state.forecastCpm}
                    onChange={(v) => setState((p) => p ? { ...p, forecastCpm: v } : p)} suffix="€" step={0.1} min={0} />
                  <div />
                </Row2>
                <Row2>
                  <DateField label="Début" value={state.startDate} onChange={(v) => setState((p) => p ? { ...p, startDate: v } : p)} />
                  <DateField label="Fin" value={state.endDate} onChange={(v) => setState((p) => p ? { ...p, endDate: v } : p)} />
                </Row2>
              </div>
            </Section>

            <Section title="Mode d'exécution">
              <OptsList>
                {(Object.keys(EXECUTION_MODE_META) as ExecutionMode[]).map((m) => (
                  <OptionRow key={m} selected={state.executionMode === m}
                    title={EXECUTION_MODE_META[m].title} sub={EXECUTION_MODE_META[m].sub}
                    onClick={() => setState((p) => p ? { ...p, executionMode: m } : p)} />
                ))}
              </OptsList>
            </Section>

            <Section title="Intensité du ciblage">
              <OptsList>
                {(Object.keys(INTENSITY_META) as Intensity[]).map((i) => (
                  <OptionRow key={i} selected={state.intensity === i}
                    title={INTENSITY_META[i].title} sub={INTENSITY_META[i].sub}
                    onClick={() => setState((p) => p ? { ...p, intensity: i } : p)} />
                ))}
              </OptsList>
            </Section>

            <Section title="Cible">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {state.cibles.length === 0 && (
                    <span style={{ fontFamily: fInter, fontSize: 12, color: C.textDim }}>National (aucune zone ciblée)</span>
                  )}
                  {state.cibles.map((c) => (
                    <span key={c.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, background: C.elevated,
                      border: `0.5px solid ${C.borderDefault}`, borderRadius: 4, padding: '3px 8px',
                      fontFamily: fInter, fontSize: 11, color: C.textSec,
                    }}>
                      {c.name}
                      <button type="button" aria-label={`Retirer ${c.name}`}
                        onClick={() => setState((p) => p ? { ...p, cibles: p.cibles.filter((x) => x.id !== c.id) } : p)}
                        style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <select
                  aria-label="Ajouter une zone existante"
                  value=""
                  onChange={(e) => {
                    const z = zonesList.find((x) => x.id === e.target.value);
                    if (z) setState((p) => p && !p.cibles.some((c) => c.id === z.id) ? { ...p, cibles: [...p.cibles, z] } : p);
                  }}
                  style={{
                    background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                    padding: '8px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none',
                  }}
                >
                  <option value="">Ajouter une zone existante…</option>
                  {zonesList.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                  Pour construire une nouvelle cible par seuil, passe par l&apos;étape Cible du wizard.
                </span>
              </div>
            </Section>

            <Section title="Canaux & liens DSP">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(['dsp', 'social', 'adserver'] as const).map((cat) => (
                  <div key={cat}>
                    <div style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, marginBottom: 6 }}>
                      {cat === 'dsp' ? 'DSP' : cat === 'social' ? 'Réseaux sociaux' : 'Ad server (mesure)'}
                    </div>
                    <OptsList>
                      {catalog.filter((r) => r.category === cat).map((r) => {
                        const list = cat === 'dsp' ? state.channels.dsps : cat === 'social' ? state.channels.socials : null;
                        const selected = list ? list.includes(r.code) : state.channels.ad_server === r.code;
                        return (
                          <OptionRow key={r.code} selected={selected} title={r.label} sub={r.category === 'adserver' ? 'Ad server' : r.category === 'dsp' ? 'DSP' : 'Social'}
                            onClick={() => setState((p) => {
                              if (!p) return p;
                              if (cat === 'adserver') return { ...p, channels: { ...p.channels, ad_server: selected ? null : r.code } };
                              const key = cat === 'dsp' ? 'dsps' : 'socials';
                              const cur = p.channels[key];
                              const next = selected ? cur.filter((c) => c !== r.code) : [...cur, r.code];
                              return { ...p, channels: { ...p.channels, [key]: next } };
                            })} />
                        );
                      })}
                    </OptsList>
                  </div>
                ))}
                {state.channels.dsps.includes('dv360') && (
                  <FieldBlock label="Liens DV360 (pour le push API — optionnels)">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {([['advertiser_id', 'Advertiser ID'], ['insertion_order_id', 'Insertion order ID'], ['algorithm_id', 'Custom bidding algorithm ID']] as const).map(([k, lab]) => (
                        <input
                          key={k}
                          type="text"
                          placeholder={lab}
                          aria-label={lab}
                          value={state.links.dv360?.[k] ?? ''}
                          onChange={(e) => setState((p) => p ? {
                            ...p,
                            links: { ...p.links, dv360: { ...p.links.dv360, [k]: e.target.value || undefined } },
                          } : p)}
                          style={{
                            background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                            padding: '8px 12px', fontFamily: fMono, fontSize: 12, color: C.text, outline: 'none',
                          }}
                        />
                      ))}
                    </div>
                  </FieldBlock>
                )}
              </div>
            </Section>

            {/* Pied : diff + raison + appliquer */}
            <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontFamily: fInter, fontSize: 11.5, color: hasDiff ? C.textSec : C.textDim }}>
                {hasDiff ? `Modifications : ${[...diff.labels, ...(linksChanged ? ['liens DSP'] : [])].join(' · ')}` : 'Aucune modification pour l’instant.'}
              </div>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Raison de l'ajustement (obligatoire — alimente le journal)"
                aria-label="Raison de l'ajustement"
                style={{
                  background: C.elevated, border: `0.5px solid ${C.border}`, borderRadius: 6,
                  padding: '10px 12px', fontFamily: fInter, fontSize: 13, color: C.text, outline: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = C.teal50; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
              />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <GhostButton label="Annuler" onClick={onClose} disabled={submitting} />
                <PrimaryButton
                  label={submitting ? 'Application…' : 'Appliquer & pousser'}
                  onClick={apply}
                  disabled={submitting || !hasDiff || reason.trim().length < 3}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import type { WizardDraftData } from '@/lib/strategy-wizard/types';
import {
  AUTONOMY_LABELS_FR, STEP_LABELS_FR,
  INVENTORY_LABELS_FR, SCOPE_LABELS_FR, WEIGHTING_MODE_LABELS_FR,
  ATTRIBUTION_LABELS_FR, PACING_LABELS_FR,
  EXECUTION_MODE_LABELS_FR, ALERT_SEVERITY_LABELS_FR,
  NOTIFICATION_CHANNEL_LABELS_FR, ALGORITHM_LABELS_FR,
  frLabel,
} from '@/lib/strategy-wizard/types';

interface Props {
  data: WizardDraftData;
  onJumpToStep: (step: number) => void;
}

interface ZoneInfo {
  name: string;
  feature_count_cp: number;
  feature_count_iris: number;
  subzones?: Array<{ id: string; name: string; cp_count: number; iris_count: number }>;
}

/** Cache d'objectifs pour traduire `objective_code` → display_name renvoyé par l'API. */
interface ObjectiveOpt { code: string; display_name: string; }

export function Step6Recap({ data, onJumpToStep }: Props) {
  const id = data.identity ?? {};
  const geo = data.geography;
  const obj = data.objective ?? {};
  const bud = data.budget ?? {};
  const ml = data.mlagent ?? {};

  // ─── Fetch nom de la zone custom (au lieu d'afficher l'UUID) ─────────────
  const [zoneInfo, setZoneInfo] = useState<ZoneInfo | null>(null);
  useEffect(() => {
    if (geo?.scope_type !== 'custom_zone' || !geo?.zone_id) {
      setZoneInfo(null);
      return;
    }
    let cancelled = false;
    adminFetch(`/api/custom-geo/${geo.zone_id}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j) setZoneInfo(j as ZoneInfo); })
      .catch(() => { /* silencieux : on retombe sur l'UUID */ });
    return () => { cancelled = true; };
  }, [geo?.scope_type, geo?.zone_id]);

  // ─── Fetch labels objectifs (display_name côté API, ex: "Maximiser leads") ─
  const [objectives, setObjectives] = useState<ObjectiveOpt[]>([]);
  useEffect(() => {
    adminFetch('/api/bidding/objectives', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { objectives: [] })
      .then(j => setObjectives((j.objectives ?? []) as ObjectiveOpt[]))
      .catch(() => {});
  }, []);
  const objectiveLabel = (code?: string): string => {
    if (!code) return '—';
    return objectives.find(o => o.code === code)?.display_name ?? code;
  };
  const kpiSecondaryLabels = (codes?: string[]): string => {
    if (!codes || codes.length === 0) return '—';
    return codes.map(c => objectives.find(o => o.code === c)?.display_name ?? c).join(', ');
  };

  // ─── Computed labels ──────────────────────────────────────────────────────
  const periodValue = id.start_date && id.end_date
    ? `${formatDate(id.start_date)} → ${formatDate(id.end_date)}`
    : '—';

  let scopeValue: string;
  if (geo?.scope_type === 'national') {
    scopeValue = SCOPE_LABELS_FR.national;
  } else if (geo?.zone_id) {
    if (zoneInfo) {
      scopeValue = `${zoneInfo.name} (${zoneInfo.feature_count_cp} CPs · ${zoneInfo.feature_count_iris} IRIS)`;
    } else {
      scopeValue = 'Zone custom (chargement…)';
    }
  } else {
    scopeValue = '—';
  }

  let modeValue = frLabel(WEIGHTING_MODE_LABELS_FR, geo?.weighting_mode);
  if (geo?.weighting_mode === 'by_subzone' && (zoneInfo?.subzones?.length ?? 0) >= 2) {
    modeValue += ` (${zoneInfo!.subzones!.length} sous-zones natives)`;
  }

  const subzonesValue = (() => {
    if (zoneInfo?.subzones?.length) {
      return zoneInfo.subzones.map(sz => sz.name).join(' · ');
    }
    if (geo?.subzones?.length) {
      return geo.subzones.map(sz => sz.name || '(sans nom)').join(' · ');
    }
    return '—';
  })();

  const algoCode = obj.algorithm_code ?? ml.algorithm_code;
  const algoMain = frLabel(ALGORITHM_LABELS_FR, algoCode, '—');
  const algoTechnical = algoCode && ALGORITHM_LABELS_FR[algoCode] ? algoCode : null;

  return (
    <div className="grid grid-cols-1 gap-4 max-w-3xl">
      <RecapSection title={STEP_LABELS_FR[1]} stepIdx={1} onEdit={() => onJumpToStep(1)}>
        <KV label="Nom" value={id.name ?? '—'} />
        <KV label="Annonceur" value={id.advertiser ?? '—'} />
        <KV label="Marque / produit" value={id.brand ?? '—'} />
        <KV label="Référence interne" value={id.internal_reference ?? '—'} />
        <KV label="Inventaire" value={frLabel(INVENTORY_LABELS_FR, id.inventory_type)} />
        <KV label="Période" value={periodValue} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[2]} stepIdx={2} onEdit={() => onJumpToStep(2)}>
        <KV label="Périmètre" value={scopeValue} />
        <KV label="Mode pondération" value={modeValue} />
        <KV label="Sous-zones" value={subzonesValue} mono={false} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[3]} stepIdx={3} onEdit={() => onJumpToStep(3)}>
        <KV label="Algorithme" value={algoTechnical ? `${algoMain} (${algoTechnical})` : algoMain} />
        <KV label="Objectif primaire" value={objectiveLabel(obj.objective_code)} />
        <KV label="Cible quantifiée" value={obj.kpi_target?.toString() ?? '—'} />
        <KV label="KPIs secondaires" value={kpiSecondaryLabels(obj.kpi_secondary)} mono={false} />
        <KV label="Modèle d'attribution" value={frLabel(ATTRIBUTION_LABELS_FR, obj.attribution_model)} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[4]} stepIdx={4} onEdit={() => onJumpToStep(4)}>
        <KV label="Budget total" value={bud.total_budget != null ? `${formatNum(bud.total_budget)} ${bud.currency ?? 'EUR'}` : '—'} />
        <KV label="Budget journalier max" value={bud.daily_budget_max != null ? `${formatNum(bud.daily_budget_max)} ${bud.currency ?? 'EUR'}` : '—'} />
        <KV label="ID DSP externe" value={bud.dsp_external_id ?? '—'} />
        <KV label="CPM prévisionnel" value={bud.forecast_cpm != null ? `${bud.forecast_cpm.toFixed(2)} ${bud.currency ?? 'EUR'}` : '—'} />
        <KV label="Distribution temporelle" value={frLabel(PACING_LABELS_FR, bud.pacing_strategy)} />
        <KV label="Plafond de répétition" value={bud.frequency_cap_imps ? `${bud.frequency_cap_imps} imp / ${bud.frequency_cap_period_days ?? 1}j` : '—'} />
      </RecapSection>

      <RecapSection title={STEP_LABELS_FR[5]} stepIdx={5} onEdit={() => onJumpToStep(5)}>
        <KV label="Mode d'exécution" value={frLabel(EXECUTION_MODE_LABELS_FR, ml.execution_mode ?? 'suggest')} />
        <KV
          label="Autonomie de l'agent"
          value={
            ml.agent_autonomy_override === null || ml.agent_autonomy_override === undefined
              ? 'Hérité du défaut user'
              : `Niveau ${ml.agent_autonomy_override} — ${AUTONOMY_LABELS_FR[ml.agent_autonomy_override]}`
          }
          mono={false}
        />
        <KV
          label="Notifications"
          value={
            (ml.notification_channels ?? []).length > 0
              ? (ml.notification_channels ?? []).map(c => NOTIFICATION_CHANNEL_LABELS_FR[c] ?? c).join(', ')
              : '—'
          }
          mono={false}
        />
        <KV label="Seuil d'alerte" value={frLabel(ALERT_SEVERITY_LABELS_FR, ml.alert_severity_threshold)} />
      </RecapSection>
    </div>
  );
}

function RecapSection({
  title, stepIdx, onEdit, children,
}: { title: string; stepIdx: number; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="border border-border-subtle rounded-md bg-bg-level-1">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-bg-level-2">
        <div className="flex items-center gap-2">
          <Check className="h-3 w-3 text-accent-teal" />
          <span className="text-[12px] font-medium text-text-primary">Étape {stepIdx} — {title}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="text-[11px] text-accent-teal hover:text-accent-teal-hover"
        >
          Modifier
        </button>
      </header>
      <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-[12px]">
        {children}
      </dl>
    </section>
  );
}

function KV({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className={mono ? 'text-text-secondary font-mono' : 'text-text-secondary'}>{value}</dd>
    </>
  );
}

function formatDate(iso: string): string {
  // ISO 'YYYY-MM-DD' → 'DD/MM/YYYY'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatNum(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

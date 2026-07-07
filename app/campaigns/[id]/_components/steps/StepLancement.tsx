'use client';

/**
 * Étape 4/4 — Lancement : récapitulatif + CTA qui crée réellement la
 * stratégie de bidding (POST /api/bidding/strategies), puis l'active
 * (PATCH status='active') pour déverrouiller le Pilotage immédiatement.
 *
 * Résout ici le `zone_id` final à partir du panier `draft.cibles` :
 * vide → national, une zone → directe, plusieurs → fusion en zone composite
 * (POST /api/custom-geo/source/composite + /api/custom-geo/save).
 *
 * Si une stratégie existe déjà pour cette campagne (`existingStrategyId`),
 * on ré-arme celle-ci via PATCH plutôt que de tenter un POST (qui renverrait
 * un 409 conflit) — "re-arming" simple, sans sur-ingénierie.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useToast } from '@/components/ui/geo-toast';
import type { StepProps } from './types';
import {
  EXECUTION_MODE_META, INTENSITY_CURVES, INTENSITY_META, TARGET_VARIABLE_CODE,
  fmtDateShort, fmtEUR,
} from './types';
import { fInter, fMono, C, GhostButton, Lead, PrimaryButton, StepShell } from './ui';

/** n=0 → national ; n=1 → zone directe ; n>1 → crée la composite (géométrie union + save). */
async function resolveFinalZone(
  cibles: { id: string; name: string }[],
  orgId: string | null,
): Promise<{ scope_type: 'national' | 'custom_zone'; zone_id: string | null }> {
  if (cibles.length === 0) return { scope_type: 'national', zone_id: null };
  if (cibles.length === 1) return { scope_type: 'custom_zone', zone_id: cibles[0].id };
  if (!orgId) throw new Error('Organisation introuvable pour fusionner les zones cibles');
  const geoRes = await adminFetch('/api/custom-geo/source/composite', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone_ids: cibles.map((c) => c.id) }),
  });
  if (!geoRes.ok) throw new Error('Fusion des zones cibles échouée');
  const geo = await geoRes.json();
  const saveRes = await adminFetch('/api/custom-geo/save', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Cible composite (${cibles.length} zones) — ${new Date().toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`,
      source_type: 'composite',
      source_metadata: { kind: 'composite', member_zone_ids: cibles.map((c) => c.id) },
      geometry: geo.geometry,
      org_id: orgId,
    }),
  });
  if (!saveRes.ok) throw new Error('Sauvegarde de la zone composite échouée');
  if (saveRes.status === 207) {
    throw new Error('Zone composite créée mais résolution des codes échouée — relance le lancement.');
  }
  const saved = await saveRes.json();
  return { scope_type: 'custom_zone', zone_id: saved.zone_id };
}

interface Props extends StepProps {
  campaignId: string;
  campaignName: string;
  existingStrategyId: string | null;
  onPrev: () => void;
  onCompleted: () => void;
}

function RecapRow({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      border: `0.5px solid ${C.border}`, borderRadius: 8,
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: C.text }}>{title}</div>
        <div style={{ fontFamily: fInter, fontSize: 11.5, color: C.textDim, marginTop: 2 }}>{sub}</div>
      </span>
      <span aria-hidden style={{ color: 'var(--success)', fontFamily: fMono, fontSize: 13 }}>✓</span>
    </div>
  );
}

export function StepLancement({
  draft, campaignId, campaignName, existingStrategyId, onPrev, onCompleted,
}: Props) {
  const { toast: toastApi } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);

  // Org propriétaire de la campagne — nécessaire pour sauvegarder la zone
  // composite quand le panier de cibles contient plusieurs zones.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        if (!cancelled) setOwnerOrgId((orgData.owner_organization_id as string | undefined) ?? null);
      } catch { if (!cancelled) setOwnerOrgId(null); }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  const cibleTitle = draft.cibles.length === 0
    ? 'National (métropole + DROM)'
    : draft.cibles.map((c) => c.name).join(' + ');
  const invalid = (draft.cibles.length > 1 && !ownerOrgId)
    || !draft.totalBudget || !draft.startDate || !draft.endDate;

  async function handleArm() {
    if (invalid) return;
    setSubmitting(true);
    try {
      const { scope_type, zone_id } = await resolveFinalZone(draft.cibles, ownerOrgId);
      const commonFields = {
        weighting_mode: 'by_insee_variable' as const,
        in_zone_weights: {
          mode: 'by_insee_variable',
          variable_code: TARGET_VARIABLE_CODE,
          curve: INTENSITY_CURVES[draft.intensity],
        },
        out_zone_weights: {},
        scope_type,
        zone_id,
        total_budget: draft.totalBudget,
        forecast_cpm: draft.forecastCpm,
        currency: 'EUR' as const,
        execution_mode: draft.executionMode,
      };

      let strategyId = existingStrategyId;

      if (!strategyId) {
        const res = await adminFetch('/api/bidding/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: campaignId,
            name: `Pilotage — ${campaignName}`,
            algorithm_code: 'thompson_sampling',
            objective_code: 'maximize_leads',
            ...commonFields,
            start_date: draft.startDate || undefined,
            end_date: draft.endDate || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toastApi.error('Création impossible', data.error ?? `HTTP ${res.status}`);
          setSubmitting(false);
          return;
        }
        strategyId = data.strategy?.id ?? null;
      } else {
        const res = await adminFetch(`/api/bidding/strategies/${strategyId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonFields,
            start_date: draft.startDate || null,
            end_date: draft.endDate || null,
            reason: 'Reprogrammée depuis le cockpit',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toastApi.error('Mise à jour impossible', data.error ?? `HTTP ${res.status}`);
          setSubmitting(false);
          return;
        }
      }

      if (!strategyId) {
        toastApi.error('Erreur', 'Stratégie créée mais identifiant manquant');
        setSubmitting(false);
        return;
      }

      const actRes = await adminFetch(`/api/bidding/strategies/${strategyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', reason: 'Armée depuis le cockpit' }),
      });
      const actData = await actRes.json().catch(() => ({}));
      if (!actRes.ok) {
        toastApi.error('Activation impossible', actData.error ?? `HTTP ${actRes.status}`);
        setSubmitting(false);
        return;
      }

      toastApi.success('Campagne armée', 'La stratégie est active — direction le pilotage.');
      onCompleted();
    } catch (err) {
      toastApi.error('Erreur réseau', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StepShell
      title="Lancement"
      stepNumber={4}
      totalSteps={4}
      memo={{
        paragraphs: [
          <>Au lancement, la campagne passe en <strong style={{ color: C.text, fontWeight: 500 }}>Pilotage</strong> : tu suis le pacing plan-vs-réel en direct.</>,
          <>Le Bilan se remplit tout seul et sera lisible à la fin de la campagne.</>,
        ],
        tip: 'Armer une campagne ne la fige pas — le pilotage reste vivant, tu peux reprogrammer ensuite.',
        mini: [2, 3, 4],
      }}
      footer={
        <>
          <GhostButton label="← Retour" onClick={onPrev} disabled={submitting} />
          <PrimaryButton
            label={submitting ? 'Armement…' : 'Armer la campagne →'}
            onClick={handleArm}
            disabled={submitting || invalid}
          />
        </>
      }
    >
      <Lead>
        Récapitulatif avant d&apos;armer la campagne. Tout est réversible : tu pourras repasser une étape à tout moment.
      </Lead>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RecapRow
          title={`Cible · ${INTENSITY_META[draft.intensity].title}`}
          sub={`Taux d'abstention (2022) sur ${cibleTitle}`}
        />
        <RecapRow
          title={`${fmtEUR(draft.totalBudget)} · CPM ${draft.forecastCpm != null ? draft.forecastCpm.toLocaleString('fr-FR') + ' €' : '—'}`}
          sub={`${fmtDateShort(draft.startDate)} → ${fmtDateShort(draft.endDate)}`}
        />
        <RecapRow
          title={EXECUTION_MODE_META[draft.executionMode].title}
          sub={EXECUTION_MODE_META[draft.executionMode].sub}
        />
      </div>
    </StepShell>
  );
}

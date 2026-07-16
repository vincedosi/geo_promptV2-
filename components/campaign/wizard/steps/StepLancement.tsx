'use client';

/**
 * Étape 5/5 — Lancement : récapitulatif + CTA qui crée réellement la
 * stratégie de bidding (POST /api/bidding/strategies), puis l'active
 * (PATCH status='active'). Après création, l'étape reste affichée : les
 * fichiers custom bidding par canal (GET /strategies/[id]/export?channel=)
 * se téléchargent ici, puis CTA « Aller au pilotage ». Ils restent
 * disponibles au retour sur l'étape si la stratégie est déjà active
 * (prop existingStrategyActive).
 *
 * Diffusion (étape Pression) : zones strictes → out_zone exclusion (×0) ;
 * national avec surpression → out_zone uniform ×1 + courbe bornée à ≥1.
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
import { resolveFinalZone } from '@/lib/campaigns/resolve-zone';
import type { StepProps } from './types';
import {
  DIFFUSION_META, EXECUTION_MODE_META,
  buildInZoneWeights, diffusionOutZoneWeights,
  draftTotalBudget, fmtDateShort, fmtEUR, fmtMult,
  resolveDownloadStrategyId, resolvePressureIndicators,
} from './types';
import { fInter, fMono, C, GhostButton, Lead, PrimaryButton, StepShell, TealButton } from './ui';

interface Props extends StepProps {
  campaignId: string;
  campaignName: string;
  /** Annonceur/produit actuels de la campagne — pour ne PATCHer que ce qui a changé. */
  campaignAdvertiser?: string;
  campaignProduct?: string;
  existingStrategyId: string | null;
  /** true si la stratégie existante est déjà active — les téléchargements custom
   *  bidding sont alors disponibles sans re-créer (l'état local ne survit pas
   *  aux allers-retours entre étapes). */
  existingStrategyActive?: boolean;
  onPrev: () => void;
  onCompleted: () => void;
  /** Appelé après renommage réussi de la campagne (répercute le nom dans l'overlay). */
  onRenamed?: (name: string) => void;
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

/** Ligne de téléchargement du fichier custom bidding d'un canal. */
function BiddingFileRow({
  channelCode, strategyId, toastError,
}: {
  channelCode: string;
  strategyId: string | null;
  toastError: (title: string, sub?: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!strategyId || downloading) return;
    setDownloading(true);
    try {
      const res = await adminFetch(`/api/bidding/strategies/${strategyId}/export?channel=${encodeURIComponent(channelCode)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toastError('Génération impossible', data.error ?? `HTTP ${res.status}`);
        return;
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `custom_bidding_${channelCode}.txt`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError('Erreur réseau', err instanceof Error ? err.message : undefined);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      border: `0.5px solid ${C.border}`, borderRadius: 8,
    }}>
      <span style={{ flex: 1, fontFamily: fMono, fontSize: 12.5, color: C.text }}>{channelCode}</span>
      <TealButton
        label={downloading ? 'Génération…' : 'Télécharger'}
        onClick={handleDownload}
        disabled={!strategyId || downloading}
      />
    </div>
  );
}

export function StepLancement({
  draft, campaignId, campaignName, campaignAdvertiser, campaignProduct,
  existingStrategyId, existingStrategyActive,
  onPrev, onCompleted, onRenamed,
}: Props) {
  const { toast: toastApi } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  // Renseigné après création réussie dans CE montage du composant.
  const [armedStrategyId, setArmedStrategyId] = useState<string | null>(null);
  const downloadStrategyId = resolveDownloadStrategyId(
    armedStrategyId, existingStrategyId, !!existingStrategyActive,
  );

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
  const pressureIndicators = resolvePressureIndicators(draft.cibles);
  const pressureIndicatorLabel = pressureIndicators.find((i) => i.code === draft.pressureVariable)?.label
    ?? pressureIndicators[0]?.label
    ?? (draft.cibles.length > 0 ? 'pression uniforme' : "Taux d'abstention (2022)");
  // Canaux (hors DV360, qui a son wording push) dont une liaison est renseignée.
  const otherLinkedCodes = [
    ...draft.channels.dsps, ...draft.channels.socials,
    ...(draft.channels.ad_server ? [draft.channels.ad_server] : []),
  ].filter((code) => code !== 'dv360'
    && Object.values(draft.channelLinks[code] ?? {}).some((v) => typeof v === 'string' && v.trim() !== ''));
  const identitySub = [draft.advertiser.trim(), draft.product.trim()].filter(Boolean).join(' · ');
  const noChannel = draft.channels.dsps.length === 0 && draft.channels.socials.length === 0;
  const totalBudget = draftTotalBudget(draft);
  const finalName = draft.name.trim() || campaignName;
  const invalid = (draft.cibles.length > 1 && !ownerOrgId)
    || !totalBudget || !draft.startDate || !draft.endDate || noChannel || !finalName;

  async function handleArm() {
    if (invalid) return;
    setSubmitting(true);
    try {
      // Nom + annonceur/produit saisis à l'étape Cible → persistés ici
      // (best-effort : la campagne reste armable même si le PATCH échoue).
      const identity: Record<string, string> = {};
      if (finalName !== campaignName) identity.name = finalName;
      if (draft.advertiser.trim() !== (campaignAdvertiser ?? '')) identity.advertiser = draft.advertiser.trim();
      if (draft.product.trim() !== (campaignProduct ?? '')) identity.product = draft.product.trim();
      if (Object.keys(identity).length > 0) {
        try {
          const rn = await adminFetch(`/api/admin/campaigns/${campaignId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(identity),
          });
          if (rn.ok && identity.name) onRenamed?.(finalName);
        } catch { /* non bloquant */ }
      }

      const { scope_type, zone_id } = await resolveFinalZone(draft.cibles, ownerOrgId);
      const hasZones = draft.cibles.length > 0;
      // Courbe sur l'indicateur réellement ciblé (ou uniforme sans indicateur,
      // abstention en national pur — voir buildInZoneWeights). weighting_mode
      // DOIT suivre le mode réel de la courbe : sinon resolveWeightingTarget()
      // (lib/bidding-ml/metric-labels.ts) cherche un variable_code absent en
      // mode uniform et le Pilotage perd le ciblage sans erreur visible.
      const inZoneWeights = buildInZoneWeights(draft);
      const weightingMode = (inZoneWeights as { mode?: string }).mode === 'uniform' ? 'uniform' as const : 'by_insee_variable' as const;
      const commonFields = {
        weighting_mode: weightingMode,
        in_zone_weights: inZoneWeights,
        out_zone_weights: diffusionOutZoneWeights(draft.diffusion, hasZones),
        scope_type,
        zone_id,
        total_budget: totalBudget,
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
            name: `Pilotage — ${finalName}`,
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

      // Persistance des canaux — non bloquant : la stratégie est déjà créée/mise à jour.
      await adminFetch(`/api/campaigns/${campaignId}/channels`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft.channels, budgets: draft.channelBudgets, links: draft.channelLinks,
        }),
      }).catch(() => { /* non bloquant : la stratégie est déjà créée */ });

      const actRes = await adminFetch(`/api/bidding/strategies/${strategyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', reason: 'Créée depuis le cockpit' }),
      });
      const actData = await actRes.json().catch(() => ({}));
      if (!actRes.ok) {
        toastApi.error('Activation impossible', actData.error ?? `HTTP ${actRes.status}`);
        setSubmitting(false);
        return;
      }

      toastApi.success('Campagne créée', 'La stratégie est active — fichiers custom bidding disponibles.');
      setArmedStrategyId(strategyId);
    } catch (err) {
      toastApi.error('Erreur réseau', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StepShell
      title="Lancement"
      stepNumber={5}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Au lancement, la campagne passe en <strong style={{ color: C.text, fontWeight: 500 }}>Pilotage</strong> : tu suis le pacing plan-vs-réel en direct.</>,
          <>Le Bilan se remplit tout seul et sera lisible à la fin de la campagne.</>,
        ],
        tip: 'Créer la campagne ne la fige pas — le pilotage reste vivant, tu peux reprogrammer ensuite.',
        mini: [2, 3, 4],
      }}
      footer={
        armedStrategyId ? (
          <>
            <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--success)' }}>
              ✓ Campagne créée
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <PrimaryButton label="Aller au pilotage →" onClick={onCompleted} />
            </span>
          </>
        ) : (
          <>
            <GhostButton label="← Retour" onClick={onPrev} disabled={submitting} />
            <PrimaryButton
              label={submitting ? 'Création…' : 'Créer la campagne →'}
              onClick={handleArm}
              disabled={submitting || invalid}
            />
            {noChannel && (
              <span style={{ marginLeft: 'auto', fontFamily: fInter, fontSize: 11, color: 'var(--warning)' }}>
                Choisis au moins un DSP ou un réseau à l&apos;étape Canaux
              </span>
            )}
          </>
        )
      }
    >
      <Lead>
        Récapitulatif avant de créer la campagne. Tout est réversible : tu pourras repasser une étape à tout moment.
      </Lead>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RecapRow
          title={finalName}
          sub={[
            finalName !== campaignName ? `Sera renommée (actuellement « ${campaignName} »)` : 'Nom de la campagne',
            identitySub,
          ].filter(Boolean).join(' · ')}
        />
        <RecapRow
          title={`Cible · pression ${fmtMult(draft.pressure)}`}
          sub={`${pressureIndicatorLabel} sur ${cibleTitle}${
            draft.cibles.length > 0 ? ` · ${DIFFUSION_META[draft.diffusion].recap}` : ''
          }`}
        />
        <RecapRow
          title={`${fmtEUR(totalBudget)} · CPM ${draft.forecastCpm != null ? draft.forecastCpm.toLocaleString('fr-FR') + ' €' : '—'}`}
          sub={`${fmtDateShort(draft.startDate)} → ${fmtDateShort(draft.endDate)} · ${
            Object.entries(draft.channelBudgets)
              .filter(([c]) => [...draft.channels.dsps, ...draft.channels.socials].includes(c))
              .map(([c, v]) => `${c} ${v.toLocaleString('fr-FR')} €`).join(' · ') || 'répartition non saisie'
          }`}
        />
        <RecapRow
          title={EXECUTION_MODE_META[draft.executionMode].title}
          sub={EXECUTION_MODE_META[draft.executionMode].sub}
        />
      </div>

      {(draft.channels.dsps.length > 0 || draft.channels.socials.length > 0 || draft.channels.ad_server) && (
        <div style={{ fontFamily: fInter, fontSize: 12, color: C.textSec, marginTop: 8 }}>
          Canaux : {[...draft.channels.dsps, ...draft.channels.socials].join(', ') || '—'}
          {draft.channels.ad_server ? ` · ad server ${draft.channels.ad_server}` : ''}
          {draft.channels.dsps.includes('dv360') && (
            <>
              {' · '}
              {draft.channelLinks.dv360?.insertion_order_id ? (
                <span style={{ color: 'var(--success)' }}>
                  DV360 lié ({draft.channelLinks.dv360.campaign_name ?? draft.channelLinks.dv360.campaign_id}
                  {draft.channelLinks.dv360.insertion_order_name ? ` → ${draft.channelLinks.dv360.insertion_order_name}` : ''})
                </span>
              ) : (
                <span style={{ color: C.textDim }}>DV360 non lié — push bidding indisponible, export fichier OK</span>
              )}
            </>
          )}
          {otherLinkedCodes.length > 0 && (
            <>
              {' · '}
              <span style={{ color: 'var(--success)' }}>liaison renseignée : {otherLinkedCodes.join(', ')}</span>
            </>
          )}
        </div>
      )}

      {[...draft.channels.dsps, ...draft.channels.socials].length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
              Fichiers custom bidding
            </span>
            <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
              {downloadStrategyId
                ? 'Un fichier par canal, fidèle à la pression et au mode de diffusion'
                : 'Disponibles après la création de la campagne'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[...draft.channels.dsps, ...draft.channels.socials].map((code) => (
              <BiddingFileRow
                key={code}
                channelCode={code}
                strategyId={downloadStrategyId}
                toastError={(t, s) => toastApi.error(t, s)}
              />
            ))}
          </div>
        </div>
      )}
    </StepShell>
  );
}

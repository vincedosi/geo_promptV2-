'use client';

/**
 * Étape 2/5 — Zones : le périmètre géographique de diffusion. National + DROM
 * par défaut, ou une zone custom déjà sauvegardée (dessinée depuis la carte).
 * Écrit `scope_type` + `zone_id` dans le brouillon.
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { ScopeType, StepProps } from './types';
import { B, FieldBlock, Lead, OptionRow, OptsList, StandardFooter, StepShell } from './ui';

interface ZoneSummary {
  id: string;
  name: string;
  source_type: string;
  feature_count_cp: number;
  feature_count_iris: number;
}

export function StepZones({
  draft, setDraft, campaignId, onPrev, onNext,
}: StepProps & { campaignId: string; onPrev: () => void; onNext: () => void }) {
  const [zones, setZones] = useState<ZoneSummary[] | null>(null);
  const [loadingZones, setLoadingZones] = useState(false);

  // Org propriétaire de la campagne — nécessaire pour lister ses zones custom.
  useEffect(() => {
    if (draft.scopeType !== 'custom_zone' || zones !== null) return;
    let cancelled = false;
    setLoadingZones(true);
    (async () => {
      try {
        const orgRes = await adminFetch(`/api/admin/campaigns/${campaignId}/organizations`, { cache: 'no-store' });
        const orgData = orgRes.ok ? await orgRes.json() : {};
        const orgId = orgData.owner_organization_id as string | undefined;
        if (!orgId) { if (!cancelled) setZones([]); return; }
        const res = await adminFetch(`/api/custom-geo/list?org_id=${orgId}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : { zones: [] };
        if (!cancelled) setZones((data.zones ?? []) as ZoneSummary[]);
      } catch {
        if (!cancelled) setZones([]);
      } finally {
        if (!cancelled) setLoadingZones(false);
      }
    })();
    return () => { cancelled = true; };
  }, [draft.scopeType, campaignId, zones]);

  // Best-effort : une fois les zones chargées, résout le nom de la zone déjà sélectionnée
  // (utile après un préremplissage depuis une stratégie existante — recap plus lisible).
  useEffect(() => {
    if (!zones || !draft.zoneId || draft.zoneName) return;
    const match = zones.find((z) => z.id === draft.zoneId);
    if (match) setDraft((prev) => ({ ...prev, zoneName: match.name }));
  }, [zones, draft.zoneId, draft.zoneName, setDraft]);

  const switchScope = (s: ScopeType) => {
    setDraft((prev) => ({ ...prev, scopeType: s, zoneId: s === 'national' ? null : prev.zoneId, zoneName: s === 'national' ? null : prev.zoneName }));
  };

  const nextDisabled = draft.scopeType === 'custom_zone' && !draft.zoneId;

  return (
    <StepShell
      title="Zones"
      stepNumber={2}
      totalSteps={5}
      memo={{
        paragraphs: [
          <>Le périmètre borne où l&apos;argent peut partir.</>,
          <>La carte est ici un <B>outil</B> : on dessine une zone, on ne quitte pas la campagne.</>,
        ],
        tip: 'National ≠ uniforme — la cible (étape précédente) décide où ça pèse plus.',
        mini: [2, 4, 2],
      }}
      footer={<StandardFooter onPrev={onPrev} nextLabel="Continuer →" onNext={onNext} nextDisabled={nextDisabled} />}
    >
      <Lead>
        Le <B>périmètre géographique</B> de diffusion. La cible s&apos;applique à l&apos;intérieur de ce périmètre.
      </Lead>

      <FieldBlock label="Échelle">
        <OptsList>
          <OptionRow
            selected={draft.scopeType === 'national'}
            onClick={() => switchScope('national')}
            title="National + DROM"
            sub="France entière, y compris outre-mer"
          />
          <OptionRow
            selected={draft.scopeType === 'custom_zone'}
            onClick={() => switchScope('custom_zone')}
            title="Zone custom"
            sub="une zone déjà sauvegardée depuis la carte"
          />
        </OptsList>
      </FieldBlock>

      {draft.scopeType === 'custom_zone' && (
        <FieldBlock label="Choix de la zone">
          {loadingZones && (
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
              Chargement des zones…
            </div>
          )}
          {!loadingZones && zones && zones.length === 0 && (
            <div style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: 12, color: 'var(--text-tertiary)' }}>
              Aucune zone custom sauvegardée pour cette organisation. Dessine-en une depuis la carte (Zones custom).
            </div>
          )}
          {!loadingZones && zones && zones.length > 0 && (
            <OptsList>
              {zones.map((z) => (
                <OptionRow
                  key={z.id}
                  selected={draft.zoneId === z.id}
                  onClick={() => setDraft((prev) => ({ ...prev, zoneId: z.id, zoneName: z.name }))}
                  title={z.name}
                  sub={`${z.source_type} · ${z.feature_count_cp} CP / ${z.feature_count_iris} IRIS`}
                />
              ))}
            </OptsList>
          )}
        </FieldBlock>
      )}
    </StepShell>
  );
}

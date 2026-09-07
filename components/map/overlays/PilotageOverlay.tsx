'use client';

/**
 * Overlay Pilotage ML — module Custom Bidding 100% inline dans /map.
 *
 * State machine 3 vues (aucune navigation hors /map) :
 *   • view = 'list'    → liste des stratégies + détail (StrategyHeader, KPI, Choro, Timeline)
 *   • view = 'wizard'  → embarque <StrategyWizard> (création OU édition selon mode/strategyId)
 *   • view = 'history' → audit trail inline via <StrategyHistoryView>
 *
 * Préouverture par query params (lus dans app/map/page.tsx et passés via initialAction) :
 *   • ?overlay=pilotage&action=new&campaign=<id>[&draft=<id>]
 *   • ?overlay=pilotage&action=edit&strategy=<id>
 *   • ?overlay=pilotage&action=history&strategy=<id>
 */
import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { StrategyHistoryView } from '@/app/strategies/_components/StrategyHistoryView';
import {
  fInter, fMono,
  type CampaignLite, type PilotageInitialAction, type StrategyListItem, type View,
} from './pilotage/shared';
import { BackBar } from './pilotage/BackBar';
import { CampaignPicker } from './pilotage/CampaignPicker';
import { CreateWizardLoader } from './pilotage/CreateWizardLoader';
import { EditWizardLoader } from './pilotage/EditWizardLoader';
import { StrategyDetail } from './pilotage/StrategyDetail';
import { StrategyPicker } from './pilotage/StrategyPicker';

export type { PilotageInitialAction } from './pilotage/shared';

interface Props {
  /** Action initiale lue depuis ?action=... dans l'URL au moment de l'ouverture de l'overlay. */
  initialAction?: PilotageInitialAction | null;
  /** Callback appelé après consommation de l'action initiale (le parent peut nettoyer l'URL). */
  onActionConsumed?: () => void;
}

export function PilotageOverlay({ initialAction, onActionConsumed }: Props = {}) {
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null);
  const [eligibleCampaigns, setEligibleCampaigns] = useState<CampaignLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    Promise.all([
      adminFetch('/api/bidding/strategies', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : { strategies: [] }),
      adminFetch('/api/digital/campaigns', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : []),
    ]).then(([sResp, cResp]) => {
      const list = (sResp.strategies ?? []) as StrategyListItem[];
      setStrategies(list);
      // /api/digital/campaigns renvoie un tableau direct (pas { campaigns: [...] }) ;
      // on supporte les deux formes pour rester robuste.
      const camps = (Array.isArray(cResp) ? cResp : (cResp?.campaigns ?? [])) as CampaignLite[];
      setEligibleCampaigns(camps.filter(c => (c.dsp_source ?? '').toLowerCase() !== 'adform'));
      const demoAuto = list.find(s => s.is_demo && s.execution_mode === 'auto');
      const fallback = demoAuto ?? list[0] ?? null;
      if (fallback) setSelectedId(fallback.id);
    }).catch(e => setError(String(e)));
  }, [refreshKey]);

  // Consomme initialAction une fois les listes chargées
  useEffect(() => {
    if (!initialAction || strategies === null) return;
    if (initialAction.type === 'new') {
      const camp = eligibleCampaigns.find(c => c.id === initialAction.campaignId);
      setView({
        kind: 'wizard', mode: 'create',
        campaignId: initialAction.campaignId,
        campaignName: camp?.name,
        draftId: initialAction.draftId,
      });
    } else if (initialAction.type === 'edit') {
      setView({ kind: 'wizard', mode: 'edit', strategyId: initialAction.strategyId });
    } else if (initialAction.type === 'history') {
      setView({ kind: 'history', strategyId: initialAction.strategyId });
    }
    onActionConsumed?.();
  }, [initialAction, strategies, eligibleCampaigns, onActionConsumed]);

  const handleCreateNew = (campaignId: string) => {
    setShowCampaignPicker(false);
    const camp = eligibleCampaigns.find(c => c.id === campaignId);
    setView({ kind: 'wizard', mode: 'create', campaignId, campaignName: camp?.name });
  };

  const handleEdit = (strategyId: string) => {
    setView({ kind: 'wizard', mode: 'edit', strategyId });
  };

  const handleShowHistory = (strategyId: string) => {
    setView({ kind: 'history', strategyId });
  };

  const handleBackToList = () => {
    setView({ kind: 'list' });
  };

  const handleWizardCompleted = (strategyId: string) => {
    setSelectedId(strategyId);
    setView({ kind: 'list' });
    setRefreshKey(k => k + 1);
  };

  if (error) {
    return (
      <div style={{ padding: 16, color: 'var(--danger)', fontSize: 12, fontFamily: fMono }}>
        Erreur : {error}
      </div>
    );
  }

  if (strategies === null) {
    return <div style={{ padding: 16, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>Chargement…</div>;
  }

  // Vue Wizard (create ou edit)
  if (view.kind === 'wizard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <BackBar
          label={view.mode === 'create' ? 'Nouvelle stratégie' : 'Éditer la stratégie'}
          subtitle={view.mode === 'create' ? view.campaignName : undefined}
          onBack={handleBackToList}
        />
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view.mode === 'create' ? (
            <CreateWizardLoader
              campaignId={view.campaignId}
              campaignName={view.campaignName}
              draftId={view.draftId}
              onCompleted={handleWizardCompleted}
            />
          ) : (
            <EditWizardLoader
              strategyId={view.strategyId}
              onCompleted={handleWizardCompleted}
            />
          )}
        </div>
      </div>
    );
  }

  // Vue Historique
  if (view.kind === 'history') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <BackBar label="Historique de la stratégie" onBack={handleBackToList} />
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <StrategyHistoryView strategyId={view.strategyId} />
        </div>
      </div>
    );
  }

  // Vue Liste (état initial)
  if (strategies.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: fInter }}>
        <div style={{
          width: 48, height: 48, margin: '0 auto 12px', borderRadius: 12,
          background: 'var(--brand-teal-10)',
          border: '0.5px solid var(--brand-teal-30)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--brand-teal)' }}>
            <path d="M12 3l1.9 5.8L20 11l-5.8 1.9L12 19l-1.9-6.1L4 11l6.1-2.2z" />
            <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
          </svg>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>
          Aucune stratégie de Custom Bidding active
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto 16px' }}>
          Configurez votre première stratégie ML pour une campagne DSP éligible (TTD, DV360, Meta…).
        </div>

        {eligibleCampaigns.length > 0 ? (
          <button
            onClick={() => setShowCampaignPicker(true)}
            style={{
              padding: '8px 16px', fontSize: 12, fontFamily: fInter, fontWeight: 500,
              background: 'var(--brand-teal)', color: 'var(--bg-level-0)',
              border: 'none', borderRadius: 6, cursor: 'pointer',
            }}
          >
            + Nouvelle stratégie
          </button>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Aucune campagne DSP éligible disponible. Importez une campagne TTD/DV360/Meta dans Admin → Campagnes.
          </div>
        )}

        {showCampaignPicker && (
          <CampaignPicker
            campaigns={eligibleCampaigns}
            onPick={handleCreateNew}
            onClose={() => setShowCampaignPicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <StrategyPicker
        strategies={strategies}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreateNew={() => setShowCampaignPicker(true)}
      />
      {showCampaignPicker && (
        <CampaignPicker
          campaigns={eligibleCampaigns}
          onPick={handleCreateNew}
          onClose={() => setShowCampaignPicker(false)}
        />
      )}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {selectedId ? (
          <StrategyDetail
            key={selectedId}
            strategyId={selectedId}
            onEdit={() => handleEdit(selectedId)}
            onShowHistory={() => handleShowHistory(selectedId)}
          />
        ) : (
          <div style={{ padding: 20, fontSize: 12, fontFamily: fMono, color: 'var(--text-tertiary)' }}>
            Sélectionner une stratégie pour afficher le détail.
          </div>
        )}
      </div>
    </div>
  );
}


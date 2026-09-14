'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { X, Info } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { partitionCampaigns } from '@/lib/campaigns/overlay-partition';
import { CampaignCockpit } from '@/components/campaign/CampaignCockpit';
import { CampaignSuivi } from '@/components/campaign/CampaignSuivi';
import { CampaignOverview } from '@/components/campaign/CampaignOverview';
import { ActivationPanel } from '@/components/campaign/ActivationPanel';
import { CreationHall } from './CreationHall';
import { useMagelianOverlay } from './MagelianOverlayContext';
import type { MagelianTab } from './deep-link';
import { useCampagneSession } from '@/lib/campagne/CampagneSessionContext';
import { deriveCampagneActive } from '@/lib/campaigns/campagne-active';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU } from '@/lib/navigation/config';
import { empiler, depiler } from '@/lib/carte/pile-echap';

/** Identifiant fixe dans la pile Echap : une seule instance de cet overlay
 *  est montée (elle vit dans le layout), gardée ou fermée via `open`. */
const PILE_ID = 'magelian-overlay';

// ── Design tokens (DESIGN_SYSTEM.md — jamais de hex en dur) ─────────────────────
const fInter = "'Inter', system-ui, sans-serif";

/** Durée de l'animation de sortie (doit matcher --duration-exit dans globals.css). */
const EXIT_DURATION_MS = 200;

/** Campagne démo à préférer par défaut si présente dans la liste. */
const DEMO_CAMPAIGN_ID = 'dccc0000-0000-4000-8000-000000000002';

interface CampaignRef {
  id: string;
  name: string;
  dsp_source: string | null;
  total_tracked_ads: number | null;
  /** Annonceur déclaré au wizard — porte `campagneActive` (Tâche 9). */
  advertiser: string | null;
}

export function MagelianOverlay() {
  const {
    open, request, closeOverlay, clearRequest, setCampagneActive, filtreActif, closeRequestId,
  } = useMagelianOverlay();
  // Sur /map il n'y a pas de sidebar 240px mais le rail de navigation
  // (LARGEUR_RAIL) : l'overlay se cale à droite du rail (rail + écart) au
  // lieu de la sidebar (256).
  const pathname = usePathname();
  const onMap = pathname?.startsWith('/map') ?? false;
  const panelLeft = onMap ? LARGEUR_RAIL + ECART_RAIL_PANNEAU : 256;
  const panelWidth = onMap ? `calc(100vw - ${LARGEUR_RAIL + ECART_RAIL_PANNEAU + 12}px)` : 'calc(100vw - 268px)';
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // L'onglet actif vit dans la session partagée carte/overlay (Tâche 2) : il
  // survit à la bascule vers la carte au lieu de repartir sur Suivi à chaque
  // réouverture. `setTab` reste le nom local pour ne pas toucher tous les
  // appelants (clic sur un onglet, deep-link reçu overlay déjà ouvert).
  const { session, majSession } = useCampagneSession();
  const tab = session.onglet;
  const setTab = useCallback((t: MagelianTab) => majSession({ onglet: t }), [majSession]);
  const [campaigns, setCampaigns] = useState<CampaignRef[] | null>(null);
  const [strategyIds, setStrategyIds] = useState<ReadonlySet<string>>(new Set());
  const [draftSavedAt, setDraftSavedAt] = useState<ReadonlyMap<string, string>>(new Map());
  // Sélection de consultation (Suivi/Aperçu) — jamais utilisée par Création.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Campagne en cours de création/modification (null = hall).
  const [creationCampaignId, setCreationCampaignId] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [canToggleDemo, setCanToggleDemo] = useState(false);
  // Instant d'ouverture : évite que le mousedown du clic d'ouverture (ou un
  // event synthétique de la carte) referme aussitôt l'overlay via click-outside.
  const openedAtRef = useRef(0);
  // Le fetch initial capture la requête courante sans re-déclencher l'effet.
  const requestRef = useRef(request);
  useEffect(() => { requestRef.current = request; }, [request]);

  const handleClose = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeOverlay();
      setClosing(false);
    }, EXIT_DURATION_MS);
  }, [open, closing, closeOverlay]);

  // Round de correction 2 (Tâche 8) : `handleClose` change d'identité
  // exactement quand `closing` bascule à `true` — c'est-à-dire au moment
  // même où l'on ferme. S'il était le callback empilé tel quel, React
  // exécuterait le nettoyage de l'effet (`depiler`) avant de relancer le
  // nouveau, verrait l'id ABSENT et le ré-empilerait au sommet en pleine
  // fermeture. Cette ref + ce wrapper stable isolent la pile Echap de ce
  // churn : seul `open` doit gouverner le cycle empiler/depiler.
  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; }, [handleClose]);
  const fermerPourPile = useCallback(() => handleCloseRef.current(), []);

  // Round de correction 1 (Tâche 9, point 4) : `requestClose()` du contexte
  // (bascule Alt+C, bouton « Campagne / Carte » de la top bar, bouton
  // « Carte » de cet en-tête) passe par le MÊME `handleClose` animé
  // qu'Échap et le bouton Fermer, au lieu de couper `open` sec via
  // `closeOverlay()`. `lastCloseRequestIdRef` initialisé à la valeur
  // courante : seule une INCRÉMENTATION déclenche la fermeture, jamais le
  // montage initial.
  const lastCloseRequestIdRef = useRef(closeRequestId);
  useEffect(() => {
    if (closeRequestId !== lastCloseRequestIdRef.current) {
      lastCloseRequestIdRef.current = closeRequestId;
      handleCloseRef.current();
    }
  }, [closeRequestId]);

  // Monté côté client uniquement (createPortal a besoin de document).
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Horodate l'ouverture (fenêtre de garde du click-outside, ligne ~312).
  // L'onglet actif ne se réinitialise plus ici : il vit dans la session
  // partagée (session.onglet, Tâche 2) et survit à la bascule carte/overlay
  // au lieu de repartir sur Suivi à chaque réouverture.
  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  // Deep-link reçu overlay déjà ouvert : applique l'onglet demandé.
  useEffect(() => {
    if (open && request?.tab) setTab(request.tab);
  }, [open, request]);

  // Charge campagnes + stratégies + brouillons (3 appels légers, listes courtes).
  // Rafraîchi à chaque ouverture ET au retour au hall : une campagne lancée
  // depuis le wizard doit basculer côté « Modifier » / sélecteur sans F5.
  const refreshLists = useCallback(async () => {
    try {
      const [campRes, stratRes, draftRes] = await Promise.all([
        adminFetch('/api/admin/campaigns', { cache: 'no-store' }),
        adminFetch('/api/bidding/strategies', { cache: 'no-store' }),
        adminFetch('/api/bidding/strategies/drafts', { cache: 'no-store' }),
      ]);
      const campData = campRes.ok ? await campRes.json() : [];
      const list: CampaignRef[] = Array.isArray(campData)
        ? campData.map((c: CampaignRef) => ({
            id: c.id, name: c.name, dsp_source: c.dsp_source ?? null,
            total_tracked_ads: c.total_tracked_ads ?? null,
            advertiser: c.advertiser ?? null,
          }))
        : [];
      setCampaigns(list);

      const stratData = stratRes.ok ? await stratRes.json() : {};
      const strategies = new Set<string>(
        ((stratData.strategies ?? []) as Array<{ campaign_id: string }>).map((s) => s.campaign_id),
      );
      setStrategyIds(strategies);

      const draftData = draftRes.ok ? await draftRes.json() : {};
      setDraftSavedAt(new Map(
        ((draftData.drafts ?? []) as Array<{ campaign_id: string; last_saved_at: string }>)
          .map((d) => [d.campaign_id, d.last_saved_at]),
      ));
      return { list, strategies };
    } catch {
      setCampaigns([]);
      return { list: [] as CampaignRef[], strategies: new Set<string>() };
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { list, strategies } = await refreshLists();
      const { consultables } = partitionCampaigns(list, strategies);
      setSelectedId((prev) => {
        if (prev && consultables.some((c) => c.id === prev)) return prev;
        const wanted = consultables.find((c) => c.id === requestRef.current?.campaignId);
        const preferred = wanted ?? consultables.find((c) => c.id === DEMO_CAMPAIGN_ID);
        return preferred?.id ?? consultables[0]?.id ?? null;
      });
    })();
  }, [open, refreshLists]);

  // Deep-link : dirige la campagne demandée vers le bon espace dès que la liste est là.
  useEffect(() => {
    if (!open || !request?.campaignId || campaigns === null) return;
    const found = campaigns.find((c) => c.id === request.campaignId);
    if (found) {
      const consultable = (found.total_tracked_ads ?? 0) > 0 || strategyIds.has(found.id);
      if ((request.tab ?? tab) === 'strategie') setCreationCampaignId(found.id);
      else if (consultable) setSelectedId(found.id);
    }
    clearRequest();
  }, [open, request, campaigns, tab, strategyIds, clearRequest]);

  // Charge l'état du mode démo (case admin) à chaque ouverture.
  useEffect(() => {
    if (!open) return;
    adminFetch('/api/user/demo-mode', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setDemoMode(!!d.demo_mode); setCanToggleDemo(!!d.can_toggle); } })
      .catch(() => {});
  }, [open]);

  const toggleDemo = useCallback(async (on: boolean) => {
    setDemoMode(on); // optimiste
    try {
      const r = await adminFetch('/api/user/demo-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      if (!r.ok) setDemoMode(!on); // rollback
    } catch {
      setDemoMode(!on);
    }
  }, []);

  const { consultables, shells, launched } = useMemo(
    () => partitionCampaigns(campaigns ?? [], strategyIds),
    [campaigns, strategyIds],
  );

  // Contexte global "campagne active" (Tâche 9) : dérivée par la fonction
  // PURE `deriveCampagneActive` (lib/campaigns/campagne-active.ts, testée
  // isolément) de ce qui est actuellement en contexte dans l'overlay —
  // consultée (Suivi/Aperçu) via `selectedId`, ou éditée (Stratégie) via
  // `creationCampaignId` — pour la top bar et la carte flottante après
  // retour à la carte. PERSISTE à la fermeture (cette instance ne démonte
  // jamais, et ni `closeOverlay` ni `requestClose` ne dépendent de cet
  // effet). Aucun fetch : dérivé des listes déjà chargées par `refreshLists`.
  useEffect(() => {
    setCampagneActive(deriveCampagneActive(tab, creationCampaignId, selectedId, campaigns));
  }, [tab, selectedId, creationCampaignId, campaigns, setCampagneActive]);

  // Retire une campagne des listes ; répare la sélection de consultation.
  const removeCampaign = useCallback((id: string) => {
    setCampaigns((prev) => {
      const next = (prev ?? []).filter((c) => c.id !== id);
      if (selectedId === id) {
        const { consultables: nextConsultables } = partitionCampaigns(next, strategyIds);
        setSelectedId(nextConsultables[0]?.id ?? null);
      }
      return next;
    });
    if (creationCampaignId === id) setCreationCampaignId(null);
  }, [selectedId, strategyIds, creationCampaignId]);

  // Suppression depuis Aperçu (CampaignOverview).
  const handleCampaignDeleted = useCallback(() => {
    if (selectedId) removeCampaign(selectedId);
  }, [selectedId, removeCampaign]);

  // Suppression d'une coquille depuis le hall.
  const handleHallDelete = useCallback(async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/campaigns/${id}`, { method: 'DELETE' });
      if (res.ok) removeCampaign(id);
    } catch { /* la ligne reste visible, l'utilisateur peut réessayer */ }
  }, [removeCampaign]);

  // Crée une campagne vierge (dsp_source='magelian') puis ouvre le wizard dessus.
  const [creating, setCreating] = useState(false);
  const handleCreateCampaign = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await adminFetch('/api/admin/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.campaign) return;
      setCampaigns((prev) => [
        { id: d.campaign.id, name: d.campaign.name, dsp_source: 'magelian', total_tracked_ads: 0, advertiser: null },
        ...(prev ?? []),
      ]);
      setCreationCampaignId(d.campaign.id);
    } finally {
      setCreating(false);
    }
  }, [creating]);

  // Retour au hall — rafraîchit les listes : un lancement dans le wizard doit
  // faire basculer la campagne côté « Modifier » et sélecteur de consultation.
  const handleBackToHall = useCallback(() => {
    setCreationCampaignId(null);
    void refreshLists();
  }, [refreshLists]);

  // Après renommage au Lancement : répercute le nom dans les listes.
  const handleCampaignRenamed = useCallback((name: string) => {
    setCampaigns((prev) => prev ? prev.map((c) => (c.id === creationCampaignId ? { ...c, name } : c)) : prev);
  }, [creationCampaignId]);

  // Esc ferme l'overlay — via la pile Echap (lib/carte/pile-echap.ts) : le
  // dernier ouvert se ferme en premier, plus de listener direct concurrent.
  // `fermerPourPile` est stable (deps vides ci-dessus) : seul `open` doit
  // gouverner ce cycle push/pop, jamais l'identité du callback — c'est
  // exactement l'exception documentée et vérifiée par
  // tests/unit/carte/pile-echap-usage.test.ts (cette instance persiste tout
  // au long des cycles ouverture/fermeture, contrairement à OverlayPanel /
  // AIOverlay / ClusterResultsOverlay qui montent et démontent).
  useEffect(() => {
    if (!open) return;
    empiler(PILE_ID, fermerPourPile);
    return () => depiler(PILE_ID);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside : ferme si le clic est hors du panel ET hors du bouton sidebar.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      // Fenêtre de garde après ouverture : ne pas se refermer sur l'événement
      // d'ouverture lui-même.
      if (Date.now() - openedAtRef.current < 400) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.magelian-overlay-panel')) return;
      if (target.closest('[data-magelian-trigger]')) return;
      handleClose();
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, handleClose]);

  // Le portail reste monté une fois `mounted` — `hidden` retire l'élément du
  // flux ET de l'arbre d'accessibilité sans démonter les enfants (Tâche 2) :
  // l'onglet Suivi de CampaignSuivi (et sa session locale) survit à la
  // bascule vers la carte au lieu d'être détruit puis recréé.
  if (!mounted) return null;
  const masque = !open && !closing;

  const creationCampaign = creationCampaignId
    ? campaigns?.find((c) => c.id === creationCampaignId) ?? null
    : null;
  const creationIsModification = creationCampaignId !== null && strategyIds.has(creationCampaignId);
  const emptyConsultation = campaigns !== null && consultables.length === 0;

  return createPortal(
    <div
      ref={panelRef}
      className="magelian-overlay-panel"
      data-state={closing ? 'closing' : 'open'}
      role="dialog"
      aria-label="MAGELIAN"
      hidden={masque}
      aria-hidden={masque}
      inert={masque}
      style={{
        position: 'fixed',
        top: 12,
        left: panelLeft,
        width: panelWidth,
        height: 'calc(100vh - 24px)',
        background: 'var(--card-overlay, rgba(10, 10, 10, 0.92))',
        backdropFilter: 'blur(var(--backdrop-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
        border: '0.5px solid var(--border-default)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
        // Au-dessus de la carte MapLibre (conteneur /map en z-index 9999)
        // et du rail comme de la sidebar. Overlay porté sur <body>.
        zIndex: 10000,
        // L'attribut `hidden` seul ne suffirait pas : sa règle par défaut
        // (`[hidden] { display: none }`) est d'origine UA, qu'un style en
        // ligne — même `display: 'flex'` — passe toujours devant. Le masquage
        // doit donc être explicite ici, pas seulement porté par l'attribut.
        display: masque ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        willChange: 'transform, opacity',
        animation: closing
          ? 'drawerSlideOutLeft var(--duration-exit) var(--ease-exit) both'
          : 'drawerSlideInLeft var(--duration-enter) var(--ease-spring) both',
      }}
    >
      <style>{`
        @media (max-width: 768px) {
          .magelian-overlay-panel {
            left: 8px !important;
            width: calc(100vw - 16px) !important;
          }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--brand-teal)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: fInter,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            flex: 1,
          }}
        >
          MAGELIAN
        </span>
        {canToggleDemo && (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginRight: 8,
              cursor: 'pointer',
              fontFamily: fInter,
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => { void toggleDemo(e.target.checked); }}
              style={{ accentColor: 'var(--brand-teal)' }}
            />
            Mode démo
          </label>
        )}
        {/* Bascule vers la carte (Tâche 9, round de correction 1, point 3) :
            le bouton `Campagne / Carte` de MapTopBar est recouvert par cet
            overlay (z-index supérieur) tant qu'il est ouvert — ce contrôle
            rend la bascule disponible DANS les deux états, sans toucher au
            z-index. Même chemin animé que Échap/Fermer (`handleClose`). */}
        <button
          type="button"
          onClick={handleClose}
          title="Revenir à la carte (Alt+C)"
          style={{
            background: 'transparent',
            border: '0.5px solid var(--border-default)',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            fontFamily: fInter,
            fontWeight: 500,
            fontSize: 12,
            color: 'var(--text-secondary)',
            transition: 'color var(--duration-hover, 150ms) var(--ease-hover, ease), border-color var(--duration-hover, 150ms) var(--ease-hover, ease)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        >
          Carte
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fermer"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-tertiary)',
            transition: 'color var(--duration-hover, 150ms) var(--ease-hover, ease)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Tab bar — Stratégie (produire, ex-Programmer) séparée de Suivi/Aperçu (consulter) */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '0.5px solid var(--border-subtle)',
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        {([
          ['strategie', 'Stratégie'],
          ['activation', 'Activation'],
          ['suivi', 'Suivi'],
          ['apercu', 'Aperçu'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === key ? '2px solid var(--brand-teal)' : '2px solid transparent',
              padding: '10px 16px',
              marginBottom: -0.5,
              fontFamily: fInter,
              fontWeight: 500,
              fontSize: 13,
              color: tab === key ? 'var(--text-primary)' : 'var(--text-tertiary)',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sélecteur de consultation — partagé par Suivi et Aperçu uniquement :
          on choisit LA campagne à regarder. Stratégie a son propre hall. */}
      {tab !== 'strategie' && (
        <div style={{ padding: '12px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <label
            htmlFor="magelian-campaign-select"
            style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)' }}
          >
            Campagne
          </label>
          <select
            id="magelian-campaign-select"
            value={selectedId ?? ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            disabled={consultables.length === 0}
            style={{
              background: 'var(--bg-level-2)',
              border: '0.5px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '8px 12px',
              fontFamily: fInter,
              fontSize: 13,
              color: 'var(--text-primary)',
              minWidth: 260,
            }}
          >
            {campaigns === null && <option value="">Chargement…</option>}
            {emptyConsultation && <option value="">Aucune campagne</option>}
            {/* Sans campagne active (Tâche 9, étape 2) : campagnes disponibles mais aucune choisie. */}
            {campaigns !== null && !emptyConsultation && !selectedId && (
              <option value="">Choisir une campagne</option>
            )}
            {consultables.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Body scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px 24px',
          minHeight: 0,
        }}
      >
        {tab === 'strategie' && (
          creationCampaignId ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={handleBackToHall}
                  style={{
                    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)',
                  }}
                >
                  ← Choisir une autre campagne
                </button>
                <span style={{ fontFamily: fInter, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {creationIsModification ? 'Modification' : 'Création'}
                  {creationCampaign ? ` — ${creationCampaign.name}` : ''}
                </span>
              </div>
              {/* Note de périmètre (Tâche 9, étape 4 — spec §3, règle non
                  négociable) : un filtre de carte ne restreint JAMAIS le
                  périmètre d'une stratégie, qui couvre toute la campagne.
                  `filtreActif` est un miroir de lib/carte/filtre.ts porté
                  par le contexte MAGELIAN — aucun fetch. */}
              {filtreActif && (
                <div
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    background: 'var(--elevated)', border: '0.5px solid var(--border-default)',
                    borderRadius: 6, padding: '10px 12px', marginBottom: 14,
                  }}
                >
                  <Info size={14} strokeWidth={1.5} color="var(--brand-teal)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Un filtre de carte est actif. Il ne s&apos;applique pas à cette stratégie : une stratégie
                    couvre toute la campagne.
                  </span>
                </div>
              )}
              <CampaignCockpit
                key={creationCampaignId}
                campaignId={creationCampaignId}
                initialView="prog"
                wizardOnly
                onDeleted={() => removeCampaign(creationCampaignId)}
                onRenamed={handleCampaignRenamed}
              />
            </div>
          ) : (
            <CreationHall
              loading={campaigns === null}
              shells={shells}
              launched={launched}
              draftSavedAt={draftSavedAt}
              creating={creating}
              onCreate={() => { void handleCreateCampaign(); }}
              onPick={setCreationCampaignId}
              onDelete={handleHallDelete}
            />
          )
        )}

        {/* Tache 20 : l'onglet Activation, entre « je programme » et « je suis ».
            Il enveloppe le push DSP qui existait NU — ni pre-vol, ni statut par
            line item, ni historique, ni retour arriere. */}
        {tab === 'activation' && (
          selectedId ? (
            <ActivationPanel key={selectedId} campaignId={selectedId} />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne à activer — crée ta première campagne dans l&apos;onglet Stratégie.
            </div>
          ) : null
        )}

        {tab === 'suivi' && (
          selectedId ? (
            <CampaignSuivi key={selectedId} campaignId={selectedId} mapAvailable={onMap} onShowedMap={handleClose} />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne à consulter — crée ta première campagne dans l&apos;onglet Stratégie.
            </div>
          ) : null
        )}

        {tab === 'apercu' && (
          selectedId ? (
            <CampaignOverview key={selectedId} campaignId={selectedId} onDeleted={handleCampaignDeleted} />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne à consulter — crée ta première campagne dans l&apos;onglet Stratégie.
            </div>
          ) : null
        )}
      </div>
    </div>,
    document.body,
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { CampaignCockpit } from '@/components/campaign/CampaignCockpit';
import { CampaignSuivi } from '@/components/campaign/CampaignSuivi';
import { CampaignOverview } from '@/components/campaign/CampaignOverview';
import { useMagelianOverlay } from './MagelianOverlayContext';

// ── Design tokens (DESIGN_SYSTEM.md — jamais de hex en dur) ─────────────────────
const fInter = "'Inter', system-ui, sans-serif";

/** Durée de l'animation de sortie (doit matcher --duration-exit dans globals.css). */
const EXIT_DURATION_MS = 200;

/** Campagne démo à préférer par défaut si présente dans la liste. */
const DEMO_CAMPAIGN_ID = 'dccc0000-0000-4000-8000-000000000002';

type MagelianTab = 'creation' | 'suivi' | 'apercu';

interface CampaignRef {
  id: string;
  name: string;
}

export function MagelianOverlay() {
  const { open, closeOverlay } = useMagelianOverlay();
  // Sur /map il n'y a pas de sidebar 240px mais le rail d'icônes 48px :
  // l'overlay se cale à droite du rail (56) au lieu de la sidebar (256).
  const pathname = usePathname();
  const onMap = pathname?.startsWith('/map') ?? false;
  const panelLeft = onMap ? 56 : 256;
  const panelWidth = onMap ? 'calc(100vw - 68px)' : 'calc(100vw - 268px)';
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const [tab, setTab] = useState<MagelianTab>('suivi');
  const [campaigns, setCampaigns] = useState<CampaignRef[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  // Instant d'ouverture : évite que le mousedown du clic d'ouverture (ou un
  // event synthétique de la carte) referme aussitôt l'overlay via click-outside.
  const openedAtRef = useRef(0);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeOverlay();
      setClosing(false);
    }, EXIT_DURATION_MS);
  }, [closing, closeOverlay]);

  // Monté côté client uniquement (createPortal a besoin de document).
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Reset l'onglet actif à chaque nouvelle ouverture + horodate l'ouverture.
  useEffect(() => {
    if (open) {
      setTab('suivi');
      openedAtRef.current = Date.now();
    }
  }, [open]);

  // Charge la liste des campagnes une seule fois (lazy, à la première ouverture).
  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/campaigns', { cache: 'no-store' });
        const data = res.ok ? await res.json() : [];
        const list: CampaignRef[] = Array.isArray(data)
          ? data.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
          : [];
        setCampaigns(list);
        const preferred = list.find((c) => c.id === DEMO_CAMPAIGN_ID);
        setSelectedId(preferred?.id ?? list[0]?.id ?? null);
      } catch {
        setCampaigns([]);
      }
    })();
  }, [open]);

  // Esc ferme l'overlay
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

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

  if (!mounted || (!open && !closing)) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="magelian-overlay-panel"
      data-state={closing ? 'closing' : 'open'}
      role="dialog"
      aria-label="MAGELIAN"
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
        display: 'flex',
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

      {/* Tab bar */}
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
          ['suivi', 'Suivi campagne'],
          ['apercu', 'Aperçu'],
          ['creation', 'Création campagne'],
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

      {/* Sélecteur de campagne — partagé entre Création et Suivi */}
      <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
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
          disabled={!campaigns || campaigns.length === 0}
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
          {campaigns !== null && campaigns.length === 0 && <option value="">Aucune campagne</option>}
          {campaigns?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Body scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px 24px',
          minHeight: 0,
        }}
      >
        {tab === 'creation' && (
          selectedId ? (
            <CampaignCockpit key={selectedId} campaignId={selectedId} embedded initialView="prog" wizardOnly />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne disponible. Crée d&apos;abord une campagne depuis « Campagnes DSP ».
            </div>
          ) : null
        )}

        {tab === 'suivi' && (
          selectedId ? (
            <CampaignSuivi key={selectedId} campaignId={selectedId} />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne disponible. Crée d&apos;abord une campagne depuis « Campagnes DSP ».
            </div>
          ) : null
        )}

        {tab === 'apercu' && (
          selectedId ? (
            <CampaignOverview key={selectedId} campaignId={selectedId} embedded />
          ) : campaigns !== null ? (
            <div style={{ fontFamily: fInter, fontSize: 13, color: 'var(--text-tertiary)', padding: '24px 0' }}>
              Aucune campagne disponible. Crée d&apos;abord une campagne depuis « Campagnes DSP ».
            </div>
          ) : null
        )}
      </div>
    </div>,
    document.body,
  );
}

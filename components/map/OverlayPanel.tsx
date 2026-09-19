'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { LARGEUR_RAIL, ECART_RAIL_PANNEAU, type EntreeId, LARGEUR_PANNEAU } from '@/lib/navigation/config';
import { empiler, depiler } from '@/lib/carte/pile-echap';

/** Identifiant fixe dans la pile Echap : un seul OverlayPanel est monté à la
 *  fois (une seule entrée du rail peut être active), seule sa `category`
 *  change quand on bascule d'un outil à l'autre sans fermer. */
const PILE_ID = 'overlay-panel';

interface OverlayPanelProps {
  category: EntreeId;
  title: string;
  dotColor: string;
  onClose: () => void;
  children: ReactNode;
  /** Largeur en pixels. Defaut : `LARGEUR_PANNEAU` (lib/navigation/config.ts). */
  width?: number;
  /** Offset vertical pour laisser la place à une top bar (default 0) */
  topOffset?: number;
  /** Affiche un bouton Maximize / Minimize qui passe l'overlay en quasi-fullscreen */
  expandable?: boolean;
}

/**
 * Durée de l'animation de sortie (doit matcher --duration-exit dans globals.css).
 * On retient l'élément monté pendant cette durée pour permettre l'animation
 * out → unmount, conformément à la spec PROMPT.
 */
const EXIT_DURATION_MS = 200;

export function OverlayPanel({
  category,
  title,
  dotColor,
  onClose,
  children,
  width = LARGEUR_PANNEAU,
  topOffset = 0,
  expandable = false,
}: OverlayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevCategoryRef = useRef(category);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identité stable de `handleClose` (round de correction 1, Tâche 8) :
  // `onClose` est souvent une fonction fléchée inline côté appelant
  // (`onClose={() => setEntreeActive(null)}`), recréée à chaque rendu de
  // `MapPage`. Sans ces refs, `handleClose` changeait d'identité à chaque
  // rendu, ré-empilait dans la pile Echap à chaque rendu (page.tsx re-rend à
  // chaque jeton de streaming du chat) et pouvait — même après le correctif
  // du module `pile-echap.ts` — refaire tourner cet effet inutilement.
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Morph inter-catégories : quand l'utilisateur switch d'overlay (Périmètre →
  // Analyses) sans fermer, on re-trigger une mini-animation sur header+body
  // pour donner du feedback visuel (sans démonter les enfants → état préservé).
  useEffect(() => {
    if (prevCategoryRef.current === category) return;
    prevCategoryRef.current = category;
    for (const el of [headerRef.current, bodyRef.current]) {
      if (!el) continue;
      el.style.animation = 'none';
      void el.offsetHeight; // force reflow
      el.style.animation = el === headerRef.current
        ? 'overlayHeaderMorph 200ms var(--ease-out) both'
        : 'overlayCategoryMorph 280ms var(--ease-spring) both';
    }
  }, [category]);

  // Wrappe l'appel parent : déclenche l'animation de sortie puis unmount après
  // EXIT_DURATION. Deps vides : identité stable (voir les refs ci-dessus),
  // condition de garde sur `closingRef` (pas sur le state `closing`, qui
  // romprait la stabilité), `onClose` toujours lu via sa ref à jour.
  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => onCloseRef.current(), EXIT_DURATION_MS);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Esc ferme l'overlay — via la pile Echap (lib/carte/pile-echap.ts) : le
  // dernier ouvert se ferme en premier, plus de listener direct concurrent.
  // Deps VIDES à dessein (round de correction 2) : `handleClose` est stable
  // (useCallback à deps vides ci-dessus), donc l'omettre ne perd aucune
  // fraîcheur — et surtout, ça verrouille l'effet pour qu'il ne se relance
  // JAMAIS après le montage. Un tableau `[handleClose]` serait équivalent en
  // pratique, mais `tests/unit/carte/pile-echap-usage.test.ts` exige `[]`
  // littéralement : c'est la seule forme qu'aucun reformattage ni aucune
  // future dépendance ajoutée par erreur ne peut faire dériver en silence.
  useEffect(() => {
    empiler(PILE_ID, handleClose);
    return () => depiler(PILE_ID);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside : ferme si le clic est hors de l'overlay ET hors du rail
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.overlay-panel')) return;
      if (target.closest('.rail-navigation')) return;
      handleClose();
    }
    // Décaler d'un tick pour ne pas catcher le clic d'ouverture
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [handleClose]);

  return (
    <div
      ref={ref}
      className="overlay-panel"
      data-category={category}
      data-state={closing ? 'closing' : 'open'}
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        top: 12 + topOffset,
        left: LARGEUR_RAIL + ECART_RAIL_PANNEAU,
        width: expanded ? `calc(100vw - ${LARGEUR_RAIL + ECART_RAIL_PANNEAU + 24}px)` : width,
        maxWidth: expanded ? `calc(100vw - ${LARGEUR_RAIL + ECART_RAIL_PANNEAU + 24}px)` : undefined,
        maxHeight: `calc(100vh - 24px - ${topOffset}px)`,
        background: 'var(--card-overlay, rgba(10, 10, 10, 0.92))',
        backdropFilter: 'blur(var(--backdrop-blur, 4px))',
        WebkitBackdropFilter: 'blur(var(--backdrop-blur, 4px))',
        border: '0.5px solid var(--border-default, #262626)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        willChange: 'transform, opacity',
        animation: closing
          ? 'drawerSlideOutLeft var(--duration-exit) var(--ease-exit) both'
          : 'drawerSlideInLeft var(--duration-enter) var(--ease-spring) both',
      }}
    >
      {/* Header */}
      <div
        ref={headerRef}
        style={{
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
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
            background: dotColor,
            flexShrink: 0,
            // Morph couleur du dot quand la catégorie change (smooth)
            transition: 'background-color var(--duration-popover, 200ms) var(--ease-spring)',
            willChange: 'background-color',
          }}
        />
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary, #f0f0f0)',
            flex: 1,
          }}
        >
          {title}
        </span>
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Réduire' : 'Agrandir'}
            title={expanded ? 'Réduire' : 'Agrandir'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--text-tertiary, #666666)',
              transition: 'color var(--duration-hover, 150ms) var(--ease-hover, ease)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--brand-teal, #4ecdc4)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary, #666666)'; }}
          >
            {expanded ? <Minimize2 size={15} strokeWidth={1.5} /> : <Maximize2 size={15} strokeWidth={1.5} />}
          </button>
        )}
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
            color: 'var(--text-tertiary, #666666)',
            transition: 'color var(--duration-hover, 150ms) var(--ease-hover, ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary, #f0f0f0)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary, #666666)'; }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Body scrollable */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          // Les bandeaux de section sont en PLEINE LARGEUR par une marge
          // negative (`FilterSectionHeader`, `margin: 0 -16px`) qui suppose un
          // parent a 16 px de padding horizontal. Ce parent n'en a pas : chaque
          // bandeau depassait donc de 32 px et ouvrait une BARRE DE DEFILEMENT
          // HORIZONTALE en bas du panneau — mesure du 2026-09-18, sur TOUTES
          // les sections (Meteo et Indicateurs civiques comprises), pas
          // seulement celles retouchees.
          //
          // On masque le debordement plutot que de retirer la marge negative :
          // le pleine-largeur est voulu, c'est lui qui donne au bandeau son
          // bord a bord. `hidden` le fait clipper par le panneau, ce qui est
          // exactement le rendu recherche, sans barre parasite.
          overflowX: 'hidden',
          padding: '8px 0',
          minHeight: 0,
          // display: flex pour que les enfants avec h-full / flex se contraignent
          // correctement (sinon le contenu déborde la hauteur du body).
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  );
}

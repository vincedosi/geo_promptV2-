'use client';

import {
  ENTREES_NAVIGATION, LARGEUR_RAIL,
  type EntreeId, type EntreeNavigation,
} from '@/lib/navigation/config';

interface RailNavigationProps {
  /** Entree actuellement ouverte (panneau ou tiroir). null = rien d'ouvert. */
  entreeActive: EntreeId | null;
  /** Appele au clic sur n'importe quelle entree — le routage (panneau, tiroir,
   *  overlay plein ecran) est decide par l'appelant (voir app/map/page.tsx). */
  onEntree: (id: EntreeId) => void;
  /** Masque le rail (mode immersif). */
  masque?: boolean;
  /** Nombre d'alertes affiche en pastille sur l'entree Campagne. 0 = pas de pastille. */
  badgeAlertes?: number;
  /** Pastille (point 6px teal) sur l'icone de l'entree Filtre — filtre actif ou non. */
  pastille?: boolean;
}

/**
 * Rail de navigation vertical de /map — cinq themes (Assistant, Campagne,
 * Filtre, Calques, Analyse, Zones, Reglages, Aide), source unique dans
 * `lib/navigation/config.ts`. Remplace `IconBar.tsx` (2026-09-12) : largeur
 * passee de 48 a `LARGEUR_RAIL` (76) pour ne plus tronquer aucun libelle.
 */
export function RailNavigation({
  entreeActive,
  onEntree,
  masque = false,
  badgeAlertes = 0,
  pastille = false,
}: RailNavigationProps) {
  const entreesHaut = ENTREES_NAVIGATION.filter(e => e.position === 'haut');
  const entreesBas = ENTREES_NAVIGATION.filter(e => e.position === 'bas');

  return (
    <aside
      className="rail-navigation"
      data-hidden={masque ? 'true' : 'false'}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: LARGEUR_RAIL,
        background: 'var(--bg-surface)',
        borderRight: '0.5px solid var(--border-subtle, #1a1a1a)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 4,
        transform: masque ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 200ms var(--ease-out, ease)',
      }}
    >
      {entreesHaut.map(entree => (
        <EntreeBouton
          key={entree.id}
          entree={entree}
          actif={entreeActive === entree.id}
          badgeAlertes={entree.accent ? badgeAlertes : 0}
          pastille={entree.id === 'filtre' && pastille}
          onClick={() => onEntree(entree.id)}
        />
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {entreesBas.map(entree => (
          <EntreeBouton
            key={entree.id}
            entree={entree}
            actif={entreeActive === entree.id}
            badgeAlertes={0}
            onClick={() => onEntree(entree.id)}
          />
        ))}
      </div>
    </aside>
  );
}

interface EntreeBoutonProps {
  entree: EntreeNavigation;
  actif: boolean;
  badgeAlertes: number;
  /** Point 6px teal en haut-droite de l'icone (entree Filtre : filtre actif). */
  pastille?: boolean;
  onClick: () => void;
}

function EntreeBouton({ entree, actif, badgeAlertes, pastille = false, onClick }: EntreeBoutonProps) {
  const Icon = entree.icone;

  // Entrée accent (Campagne) : bouton pleine largeur, fond teal plein. La spec
  // demande « une ombre légère » mais DESIGN_SYSTEM.md §7.10 interdit toute
  // ombre — on marque la différence par le fond plein et la hauteur (56 vs 48),
  // pas de box-shadow.
  if (entree.accent) {
    return (
      <>
        <button
          type="button"
          onClick={onClick}
          title={entree.tooltip || undefined}
          aria-label={entree.label}
          aria-pressed={actif}
          style={{
            width: LARGEUR_RAIL - 8,
            height: 56,
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            background: 'var(--brand-teal)',
            color: 'var(--background)',
            border: 'none',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          {badgeAlertes > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 8,
                background: 'var(--danger)',
                color: 'var(--background)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {badgeAlertes > 99 ? '99+' : badgeAlertes}
            </span>
          )}
          <Icon size={20} strokeWidth={1.5} />
          <span
            style={{
              fontSize: 10,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              lineHeight: 1.2,
              textAlign: 'center',
            }}
          >
            {entree.label}
          </span>
        </button>
        {entree.separateurApres && <Separateur />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={entree.tooltip || undefined}
        aria-label={entree.label}
        aria-pressed={actif}
        style={{
          width: LARGEUR_RAIL - 8,
          height: 48,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          background: actif ? 'rgba(78,205,196,0.12)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background-color 150ms var(--ease-hover, ease), color 150ms var(--ease-hover, ease)',
          color: actif ? 'var(--brand-teal)' : 'var(--text-tertiary, #666666)',
        }}
        onMouseEnter={e => {
          if (!actif) e.currentTarget.style.background = 'var(--bg-level-2)';
        }}
        onMouseLeave={e => {
          if (!actif) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Indicateur actif vertical à gauche */}
        {actif && (
          <span
            style={{
              position: 'absolute',
              left: -4,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: '0 2px 2px 0',
              background: 'var(--brand-teal)',
            }}
          />
        )}
        <span style={{ position: 'relative', display: 'flex' }}>
          <Icon size={20} strokeWidth={1.5} />
          {pastille && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--brand-teal)',
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 500,
            letterSpacing: '0.01em',
            lineHeight: 1.2,
            textAlign: 'center',
            color: 'inherit',
          }}
        >
          {entree.label}
        </span>
      </button>
      {entree.separateurApres && <Separateur />}
    </>
  );
}

function Separateur() {
  return (
    <div
      style={{
        width: 24,
        height: 0.5,
        background: 'var(--border-subtle, #1a1a1a)',
        margin: '4px 0',
      }}
    />
  );
}

'use client';

/**
 * @file app/map/_components/panneaux/PanneauZones.tsx — panneau « Zones »
 * (Tâche 7, 2026-09-12).
 *
 * Contenu de l'entrée « Zones » du rail (lib/navigation/config.ts) : « Ce que
 * je fabrique ». Deux sections :
 *
 *   - « Créer une zone » : la capture des couches actives (`CustomGeoCaptureModal`,
 *     jusqu'à 11 sources contributives via `useCustomGeoCaptureContext`) —
 *     reprise VERBATIM de l'entrée « Capturer zone custom » de
 *     `SettingsOverlay.tsx` (avant cette tâche), qui la perd. Dessin libre,
 *     rayon comme outil de zone et import de codes postaux **n'existent pas**
 *     dans le code — décision du contrôleur : ne pas poser de bouton mort,
 *     ils arrivent aux Tâches 16-18 (Phase 2). **Import de codes postaux et
 *     rayon et dessin libre livrés le 2026-09-13** (Tâches 16, 17 et 18).
 *   - « Mes zones » : `ZonesOverlay` (components/map/overlays/ZonesOverlay.tsx)
 *     déplacée TELLE QUELLE (fichier non relocalisé physiquement, seulement
 *     réimporté ici — même convention que `PanneauCalques`/`PanneauAnalyse`
 *     pour les sections reprises de `filter-panel/`). Composition en clair et
 *     opérations booléennes (Fusionner/Intersection/Soustraire) : Phase 2
 *     (Tâche 14), non implémentées ici.
 */
import { useState } from 'react';
import { Save as SaveIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { useCustomGeoCaptureContext } from '@/lib/custom-geo/CustomGeoCaptureContext';
import { retryImport } from '@/lib/dynamic-with-retry';
import { ZonesOverlay } from '@/components/map/overlays/ZonesOverlay';
import { CreerZoneCodesPostaux } from './CreerZoneCodesPostaux';
import { CreerZoneRayon } from './CreerZoneRayon';
import { CreerZoneDessin } from './CreerZoneDessin';
import { JeuxDeZonesRail } from './JeuxDeZonesRail';

const CustomGeoCaptureModal = dynamic(
  retryImport(() => import('@/components/custom-geo/CustomGeoCaptureModal').then((m) => ({ default: m.CustomGeoCaptureModal }))),
  { ssr: false, loading: () => null }
);

export interface PanneauZonesProps {
  mapRef: React.MutableRefObject<MaplibreMap | null>;
  /** Notifie le parent des zones actuellement affichées sur la carte (plan média). */
  onLoadedZonesChange?: (zones: Array<{ id: string; name: string }>) => void;
  /**
   * Ouvre l'atelier « Population à risque industriel » sur un jeu enregistré.
   *
   * Optionnelle : sans elle, la section des jeux n'est pas rendue du tout —
   * une liste dont les entrées ne s'ouvrent pas serait une impasse.
   */
  onOuvrirJeu?: (id: string) => void;
}

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  letterSpacing: '0.04em',
  marginBottom: 8,
  marginTop: 0,
};

export function PanneauZones({ mapRef, onLoadedZonesChange, onOuvrirJeu }: PanneauZonesProps) {
  const { layerCount } = useCustomGeoCaptureContext();
  const [customGeoModalOpen, setCustomGeoModalOpen] = useState(false);
  // Rafraichit « Mes zones » apres une creation.
  //
  // C'etait une `key` — et c'etait un defaut serieux, trouve en relecture. Une
  // `key` qui change DEMONTE `ZonesOverlay`, dont le nettoyage de demontage
  // capture le `loadedZones` du PREMIER rendu (deps `[]`) et n'itere donc
  // jamais rien. Resultat : les couches MapLibre des zones affichees restaient
  // peintes pendant que l'etat repartait vide — des zones visibles qu'aucun
  // bouton ne pouvait plus masquer, et un `onLoadedZonesChange([])` qui mentait
  // a ses consommateurs. Une simple prop relue par `fetchAll` recharge la liste
  // SANS demonter.
  const [rafraichir, setRafraichir] = useState(0);
  const customGeoDisabled = layerCount === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>

      {/* ── Créer une zone ─────────────────────────────────────────────── */}
      <section style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border-subtle)' }}>
        <h4 style={sectionTitleStyle}>Créer une zone</h4>
        <button
          type="button"
          onClick={() => setCustomGeoModalOpen(true)}
          disabled={customGeoDisabled}
          title={customGeoDisabled ? 'Aucune zone à capturer (active au moins un layer terrain)' : 'Capturer la vue comme zone custom'}
          style={{
            width: '100%',
            background: 'transparent',
            border: `0.5px solid ${customGeoDisabled ? 'var(--border-default)' : 'var(--brand-teal)'}`,
            color: customGeoDisabled ? 'var(--text-tertiary)' : 'var(--brand-teal)',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 500,
            cursor: customGeoDisabled ? 'not-allowed' : 'pointer',
            opacity: customGeoDisabled ? 0.5 : 1,
            fontFamily: "'Inter', system-ui, sans-serif",
            transition: 'background-color 150ms var(--ease-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onMouseEnter={e => { if (!customGeoDisabled) e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <SaveIcon size={14} strokeWidth={1.5} />
          Capturer zone custom
          {layerCount > 0 && (
            <span style={{
              marginLeft: 'auto',
              minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 9, background: 'var(--brand-teal)',
              color: 'var(--brand-teal-fg)', fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{layerCount}</span>
          )}
        </button>

        {/* Tache 16 et 17 : deux autres facons de fabriquer une zone, a cote de
            la capture de couches. L'en-tete de ce fichier annoncait qu'elles
            « n'existent pas dans le code » et arriveraient en Phase 2 — c'est
            fait. Le dessin libre (Tache 18) reste a venir. */}
        <CreerZoneCodesPostaux onCree={() => setRafraichir((n) => n + 1)} />
        <CreerZoneRayon mapRef={mapRef} onCree={() => setRafraichir((n) => n + 1)} />
        <CreerZoneDessin mapRef={mapRef} onCree={() => setRafraichir((n) => n + 1)} />
      </section>
      {customGeoModalOpen && <CustomGeoCaptureModal onClose={() => setCustomGeoModalOpen(false)} />}

      {/* ── Jeux de zones ──────────────────────────────────────────────
          Un jeu de zones EST une zone : un périmètre nommé, enregistré,
          réutilisable. Le chercher dans l'atelier suppose de se rappeler où
          il a été fabriqué, alors que ce panneau est justement l'endroit où
          l'on vient chercher un périmètre qu'on a déjà.

          Placé AVANT « Mes zones » : les jeux de zones sont peu nombreux et
          portent un plan de campagne, là où « Mes zones » peut compter des
          dizaines d'entrées et se parcourt en défilant. */}
      {onOuvrirJeu && (
        <section style={{ padding: '12px 0 0', borderBottom: '0.5px solid var(--border-subtle)' }}>
          <h4 style={{ ...sectionTitleStyle, padding: '0 16px' }}>Jeux de zones à risque</h4>
          <JeuxDeZonesRail onOuvrir={onOuvrirJeu} />
        </section>
      )}

      {/* ── Mes zones ──────────────────────────────────────────────────── */}
      <section style={{ padding: '12px 0 0' }}>
        <h4 style={{ ...sectionTitleStyle, padding: '0 16px' }}>Mes zones</h4>
        <ZonesOverlay rafraichirCle={rafraichir} mapRef={mapRef} onLoadedZonesChange={onLoadedZonesChange} />
      </section>

    </div>
  );
}

'use client';

/**
 * Section « Zones à risque industriel » du panneau Calques.
 *
 * ── Pourquoi une section à part et pas une entrée de la liste des POI ──────
 *
 * Demande explicite : cette donnée n'est pas un POI comme un lycée. Elle a son
 * niveau réglementaire, son type de risque, sa zone de danger et sa propre
 * légende — rien de tout cela n'a de place dans un sélecteur générique où elle
 * ne serait qu'une ligne parmi d'autres. `risque_industriel` est donc RETIRÉ de
 * la liste des types de POI (voir `PanneauCalques`) et vit ici.
 *
 * ── Le défaut est Seveso, et c'est un choix de justesse ───────────────────
 *
 * La base porte 99 152 installations classées, dont seulement 1 327 Seveso.
 * Les 98 000 autres sont des carrières, entrepôts, stations-service,
 * chaufferies : des installations classées, pas des sites à risque majeur.
 * Ouvrir sur « tout » noierait les 1 327 sites qui comptent — et 99 152 points
 * ne s'affichent de toute façon pas. Les autres niveaux restent à un clic.
 */
import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { C, fInter, fMono } from './tokens';
import { labelStyle } from './styles';
import { ORDRE_TYPES, LIBELLE_TYPE, COULEURS_CSS } from '@/lib/carte/palette-risques';

/**
 * Niveaux réglementaires, du plus grave au moins.
 *
 * NON exportée : rien d'autre ne la nomme, et `knip` comptait l'export comme
 * mort (cliquet de tests/unit/docs/catalogue-code.test.ts).
 */
const NIVEAUX_RISQUE = [
  { id: 'seveso_haut', label: 'Seveso seuil haut' },
  { id: 'seveso_bas', label: 'Seveso seuil bas' },
  { id: 'ied', label: 'Directive IED' },
  { id: 'autorisation', label: 'Autorisation' },
  { id: 'enregistrement', label: 'Enregistrement' },
  { id: 'autre', label: 'Régime déclaratif ou non précisé' },
] as const;

/** Rayons proposés pour la zone de danger. 0 = aucune zone. */
const RAYONS = [0, 300, 500, 1000, 2000, 5000] as const;

export interface RisqueIndustrielSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  actif: boolean;
  setActif: (v: boolean) => void;

  /** Niveaux réglementaires retenus. */
  niveaux: string[];
  setNiveaux: (v: string[]) => void;

  /** Types de risque retenus (vide = tous). */
  typesRisque: string[];
  setTypesRisque: (v: string[]) => void;

  inclureInactifs: boolean;
  setInclureInactifs: (v: boolean) => void;

  rayonM: number;
  setRayonM: (v: number) => void;

  afficherHalo: boolean;
  setAfficherHalo: (v: boolean) => void;

  /** Compte remonté par la couche : rendus / total du filtre. */
  compte: { rendus: number; total: number } | null;
}

export function RisqueIndustrielSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  actif,
  setActif,
  niveaux,
  setNiveaux,
  typesRisque,
  setTypesRisque,
  inclureInactifs,
  setInclureInactifs,
  rayonM,
  setRayonM,
  afficherHalo,
  setAfficherHalo,
  compte,
}: RisqueIndustrielSectionProps) {
  const ouvert = sectionsOpen.risqueIndustriel !== false;

  return (
    <div style={{ paddingBottom: 4 }}>
      <FilterSectionHeader
        label="Zones à risque industriel"
        sectionKey="risqueIndustriel"
        open={ouvert}
        onToggle={() => toggleSection('risqueIndustriel')}
        count={actif ? niveaux.length : 0}
        searchTerm={filterSearch}
      />

      {ouvert && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 14px 12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={actif}
              onChange={(e) => setActif(e.target.checked)}
              style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
            />
            <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>
              Afficher sur la carte
            </span>
          </label>

          {actif && (
            <>
              {/* ── Niveau réglementaire ─────────────────────────────── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={labelStyle}>Niveau</span>
                <MultiDropdown
                  label="Aucun niveau"
                  items={NIVEAUX_RISQUE.map((n) => ({ id: n.id, label: n.label }))}
                  selected={niveaux}
                  onChange={setNiveaux}
                />
                <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim }}>
                  1 327 sites Seveso en France sur 99 152 installations classées.
                </span>
              </div>

              {/* ── Type de risque ───────────────────────────────────── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={labelStyle}>Type de risque</span>
                <MultiDropdown
                  label="Tous les types"
                  items={ORDRE_TYPES.map((t) => ({ id: t, label: LIBELLE_TYPE[t] }))}
                  selected={typesRisque}
                  onChange={setTypesRisque}
                />
              </div>

              {/* ── Zone de danger ───────────────────────────────────── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={labelStyle}>Zone de danger</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {RAYONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRayonM(r)}
                      style={{
                        background: rayonM === r ? 'var(--brand-teal-10)' : 'transparent',
                        border: `0.5px solid ${rayonM === r ? 'var(--brand-teal)' : C.border}`,
                        color: rayonM === r ? 'var(--brand-teal)' : C.textSec,
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontFamily: fMono,
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      {r === 0 ? 'aucune' : r < 1000 ? `${r} m` : `${r / 1000} km`}
                    </button>
                  ))}
                </div>
                {rayonM > 0 && (
                  <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
                    Rayon indicatif autour du site, calculé en mètres réels.
                    Ce n&apos;est pas le périmètre réglementaire d&apos;un PPRT.
                  </span>
                )}
              </div>

              {/* ── Halo de lecture ─────────────────────────────────── */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={afficherHalo}
                  onChange={(e) => setAfficherHalo(e.target.checked)}
                  style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                />
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                  Halo autour des points
                </span>
              </label>

              {/* ── Sites à l'arrêt ─────────────────────────────────── */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={inclureInactifs}
                  onChange={(e) => setInclureInactifs(e.target.checked)}
                  style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                />
                <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                  Inclure les sites à l&apos;arrêt
                </span>
              </label>

              {/* ── Légende : la couleur porte le TYPE de risque ─────── */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={labelStyle}>Couleur du point et de sa zone</span>
                {ORDRE_TYPES.map((t) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: COULEURS_CSS[t],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                      {LIBELLE_TYPE[t]}
                    </span>
                  </div>
                ))}
              </div>

              {/* Un compte tronqué doit le dire : la couche coupe les sites les
                  moins graves en premier, jamais un Seveso. */}
              {compte && (
                <span style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                  {compte.rendus === compte.total
                    ? `${compte.rendus} site${compte.rendus > 1 ? 's' : ''} dans la vue`
                    : `${compte.rendus} sites affichés sur ${compte.total} — zoomez pour les voir tous`}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

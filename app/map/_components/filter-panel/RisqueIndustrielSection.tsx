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
import { COULEURS_PPRT_CSS, TIRETE_PPRT, LIBELLE_TYPE_ZONE_PPRT } from '@/lib/carte/palette-pprt';
import { PPRT_ZOOM_PLANCHER } from '@/lib/version';
import type { EtatCouchePprt } from '../PprtLayer';

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

/**
 * Les trois familles de `pprt_perimetres.type_zone`, dans l'ordre de leur
 * effectif mesuré (639 / 18 / 7 sur les 664 zones).
 *
 * NON exportée : rien d'autre ne la nomme, et `knip` compterait l'export comme
 * mort (cliquet de tests/unit/docs/catalogue-code.test.ts).
 */
const TYPES_ZONE_PPRT = ['enveloppe', 'perimetre_reglemente', 'indetermine'] as const;

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

  /** Couche « Périmètre PPRT » — servitudes PM3, distincte du rayon calculé. */
  pprtActif: boolean;
  setPprtActif: (v: boolean) => void;
  pprtTypes: string[];
  setPprtTypes: (v: string[]) => void;
  pprtEtat: EtatCouchePprt | null;
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
  pprtActif,
  setPprtActif,
  pprtTypes,
  setPprtTypes,
  pprtEtat,
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

          {/* ── Périmètre PPRT ────────────────────────────────────────────
              HORS du bloc `actif` à dessein : c'est une couche INDÉPENDANTE.
              On doit pouvoir afficher les périmètres réglementaires sans
              afficher les 99 152 points, et l'inverse. */}
          <div
            style={{
              borderTop: `1px solid ${C.border}`,
              marginTop: 4,
              paddingTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pprtActif}
                onChange={(e) => setPprtActif(e.target.checked)}
                style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
              />
              <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>
                Périmètre PPRT (officiel)
              </span>
            </label>

            <span style={{ fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
              664 périmètres réglementaires opposables, 87 départements sur les 88
              qui ont un PPRT. À ne pas confondre avec le rayon indicatif ci-dessus.
            </span>

            {pprtActif && (
              <>
                {/* L'indice qui évite une case cochée sans effet : sous ce
                    zoom, une zone de 2 km fait moins d'un pixel et la couche
                    ne demande RIEN. */}
                {pprtEtat?.sousLePlancher && (
                  <span
                    style={{
                      fontFamily: fInter,
                      fontSize: 10,
                      color: 'var(--warning)',
                      lineHeight: 1.4,
                    }}
                  >
                    Zoomez au niveau {PPRT_ZOOM_PLANCHER} pour voir les périmètres —
                    plus loin, une zone mesure moins d&apos;un pixel.
                  </span>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={labelStyle}>Nature du périmètre</span>
                  <MultiDropdown
                    label="Toutes les natures"
                    items={TYPES_ZONE_PPRT.map((t) => ({
                      id: t,
                      label: LIBELLE_TYPE_ZONE_PPRT[t],
                    }))}
                    selected={pprtTypes}
                    onChange={setPprtTypes}
                  />
                </div>

                {/* Légende : le TRAIT porte l'autorité, pas la teinte — la
                    couleur de cette carte est réservée au type de risque. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 22,
                      height: 0,
                      flexShrink: 0,
                      borderTop: `1.5px dashed ${COULEURS_PPRT_CSS.contour}`,
                    }}
                  />
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>
                    Périmètre opposable (tireté {TIRETE_PPRT.join('/')})
                  </span>
                </div>

                {pprtEtat && !pprtEtat.sousLePlancher && (
                  <span style={{ fontFamily: fMono, fontSize: 10, color: C.textDim }}>
                    {pprtEtat.rendus === pprtEtat.total
                      ? `${pprtEtat.rendus} périmètre${pprtEtat.rendus > 1 ? 's' : ''} dans la vue`
                      : `${pprtEtat.rendus} affichés sur ${pprtEtat.total} — les plus petits sont coupés`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * Section « Points d'intérêt (POI) » de la catégorie Terrain : sélection des
 * types, réglage épingle/couleur/nature par type retenu, affichage carte et
 * bascule mode densité.
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import type { POIStyle } from './poi-style';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { PIN_COLORS, PIN_SIZES } from './constants';
import { C, fInter, fMono } from './tokens';
import { labelStyle, primaryBtn } from './styles';

export interface PoiSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  selectedPOI: string[];
  setSelectedPOI: (next: string[] | ((prev: string[]) => string[])) => void;

  /** Catalogue des types de POI disponibles (chargé depuis l'API). */
  poiTypes: { id: string; label: string }[];
  catsLoading: boolean;
  catsError: string | null;
  fetchCategories: (forceRefresh?: boolean) => void;

  getPOIStyle: (poi: string) => POIStyle;
  setPOIStyle: (poi: string, patch: Partial<POIStyle>) => void;
  setPoiStyles: React.Dispatch<React.SetStateAction<Record<string, POIStyle>>>;

  /** Natures disponibles par type de POI (metadata->>'libelle_nature'). */
  poiNatures: Record<string, string[]>;

  /**
   * Afficher les installations classees dont l'activite a cesse. FAUX par
   * defaut : 19 % des sites importes sont « En fin d'exploitation ».
   */
  inclureInactifsIcpe: boolean;
  setInclureInactifsIcpe: React.Dispatch<React.SetStateAction<boolean>>;
  selectedPoiNatures: Record<string, string[]>;
  setSelectedPoiNatures: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;

  hasAnyPOI: boolean;
  searchLoading: boolean;
  handleSearchPOI: () => void;

  densityMode?: boolean;
  onDensityModeChange?: (v: boolean) => void;
}

export function PoiSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  selectedPOI,
  setSelectedPOI,
  poiTypes,
  catsLoading,
  catsError,
  fetchCategories,
  getPOIStyle,
  setPOIStyle,
  setPoiStyles,
  poiNatures,
  inclureInactifsIcpe,
  setInclureInactifsIcpe,
  selectedPoiNatures,
  setSelectedPoiNatures,
  hasAnyPOI,
  searchLoading,
  handleSearchPOI,
  densityMode,
  onDensityModeChange,
}: PoiSectionProps) {
  return (
    <div style={{ paddingBottom: 4 }}>
      <FilterSectionHeader label="Points d'intérêt (POI)" sectionKey="poi" open={sectionsOpen.poi !== false} onToggle={() => toggleSection('poi')} count={selectedPOI.length} tooltipKey="poi" searchTerm={filterSearch} />
      {sectionsOpen.poi !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>
    <div>
      <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>
          Types de POI
          {selectedPOI.length > 0 && <span style={{ color: C.textSec }}> — {selectedPOI.length} sélectionné{selectedPOI.length > 1 ? 's' : ''}</span>}
          {!catsLoading && poiTypes.length > 0 && <span style={{ color: C.textDim }}> ({poiTypes.length})</span>}
        </span>
        <button
          onClick={() => fetchCategories(true)}
          title="Rafraîchir la liste"
          style={{ background: 'none', border: 'none', color: catsLoading ? C.muted : C.textDim, cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }}
        >{catsLoading ? '…' : '↻'}</button>
      </div>
      {/* Affiche l'erreur SEULEMENT si on n'a aucune catégorie chargée
          (sinon c'est un refresh raté non bloquant — la liste reste utilisable) */}
      {catsError && poiTypes.length === 0 && (
        <div style={{ fontFamily: fMono, fontSize: 10, color: C.red, marginBottom: 4 }}>
          ! Erreur chargement catégories : {catsError} — <button onClick={() => fetchCategories(true)} style={{ background: 'none', border: 'none', color: C.amber, cursor: 'pointer', fontSize: 10, fontFamily: fMono, padding: 0 }}>réessayer</button>
        </div>
      )}
      <MultiDropdown
        label="Aucun type selectionne"
        items={poiTypes}
        selected={selectedPOI}
        onChange={setSelectedPOI}
      />
      {/* Cartes POI sélectionnés */}
      {selectedPOI.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {selectedPOI.map(poi => {
            const style = getPOIStyle(poi);
            // Style commun pour les selects : avec flèche ▾ custom
            const selectBase: React.CSSProperties = {
              fontFamily: fInter, fontSize: 13,
              background: C.bgInput,
              border: `0.5px solid ${C.border}`, borderRadius: 4,
              color: C.text, padding: '4px 22px 4px 8px',
              outline: 'none', cursor: 'pointer', flex: 1, width: '100%',
              appearance: 'none' as const,
            };
            const selectWrap: React.CSSProperties = {
              position: 'relative', flex: 1, display: 'flex', alignItems: 'center',
            };
            const selectArrow: React.CSSProperties = {
              position: 'absolute', right: 7, pointerEvents: 'none',
              fontFamily: fInter, fontSize: 9, color: C.textDim, lineHeight: 1,
            };
            return (
              <div key={poi} style={{
                background: 'rgba(255,255,255,0.02)',
                border: `0.5px solid ${C.border}`,
                borderRadius: 4, padding: '8px 10px',
                display: 'flex', flexDirection: 'column', gap: 7,
              }}>
                {/* Header : nom + bouton X */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: C.text }}>
                    {poi}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedPOI(prev => prev.filter(p => p !== poi));
                      setPoiStyles(prev => { const n = { ...prev }; delete n[poi]; return n; });
                    }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: C.muted, fontSize: 11, lineHeight: 1, padding: '0 2px',
                      fontFamily: fMono,
                    }}
                    title="Retirer ce POI"
                  >✕</button>
                </div>

                {/* Épingle (taille) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', width: 50 }}>
                    Épingle
                  </span>
                  <div style={selectWrap}>
                    <select
                      value={style.size}
                      onChange={e => setPOIStyle(poi, { size: e.target.value })}
                      style={selectBase}
                    >
                      {PIN_SIZES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <span style={selectArrow}>▾</span>
                  </div>
                </div>

                {/* Couleur */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', width: 50 }}>
                    Couleur
                  </span>
                  <div style={{ ...selectWrap }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: style.color,
                      border: `1px solid rgba(255,255,255,0.15)`,
                      position: 'absolute', left: 7, pointerEvents: 'none', zIndex: 1,
                      flexShrink: 0,
                    }} />
                    <select
                      value={style.color}
                      onChange={e => setPOIStyle(poi, { color: e.target.value })}
                      style={{ ...selectBase, paddingLeft: 24 }}
                    >
                      {PIN_COLORS.map(c => (
                        <option key={c.hex} value={c.hex}>{c.label}</option>
                      ))}
                    </select>
                    <span style={selectArrow}>▾</span>
                  </div>
                </div>

                {/* Nature (metadata->>'libelle_nature') */}
                {poiNatures[poi]?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                      Nature
                      {(selectedPoiNatures[poi]?.length ?? 0) > 0 && (
                        <span style={{ color: C.textSec }}>
                          {' '}— {selectedPoiNatures[poi].length} sélectionnée{selectedPoiNatures[poi].length > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                    <MultiDropdown
                      label="Toutes les natures"
                      items={poiNatures[poi].map(n => ({ id: n, label: n }))}
                      selected={selectedPoiNatures[poi] ?? []}
                      onChange={sel => setSelectedPoiNatures(prev => ({ ...prev, [poi]: sel }))}
                    />
                  </div>
                )}

                {/*
                  Deux elements propres aux installations classees.

                  La case « sites a l'arret » : 19 % des sites importes sont
                  « En fin d'exploitation ». Les afficher a cote des sites
                  actifs ferait lire un risque industriel la ou l'activite a
                  cesse — d'ou le masquage par defaut, et le dire plutot que
                  le taire.

                  La legende : la couleur du point porte la GRAVITE
                  reglementaire (sous_categorie), pendant que le filtre ci-dessus
                  porte la NATURE du risque. Deux dimensions, deux roles : sans
                  legende, personne ne peut savoir laquelle il lit.
                */}
                {poi === 'risque_industriel' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={inclureInactifsIcpe}
                        onChange={e => setInclureInactifsIcpe(e.target.checked)}
                        style={{ accentColor: 'var(--brand-teal)', cursor: 'pointer' }}
                      />
                      <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                        Inclure les sites a l&apos;arret
                      </span>
                    </label>

                    <span style={{ fontFamily: fInter, fontSize: 11, color: C.textDim }}>
                      Couleur du point : gravite
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {[
                        { cle: 'seveso_haut', libelle: 'Seveso seuil haut', jeton: 'var(--seq-5)' },
                        { cle: 'seveso_bas', libelle: 'Seveso seuil bas', jeton: 'var(--seq-4)' },
                        { cle: 'ied', libelle: 'Directive IED', jeton: 'var(--seq-3)' },
                        { cle: 'autorisation', libelle: 'Autorisation', jeton: 'var(--seq-2)' },
                        { cle: 'enregistrement', libelle: 'Enregistrement', jeton: 'var(--seq-1)' },
                        { cle: 'autre', libelle: 'Regime declaratif ou non precise', jeton: 'var(--donnee-absente)' },
                      ].map(({ cle, libelle, jeton }) => (
                        <div key={cle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: jeton, flexShrink: 0 }} />
                          <span style={{ fontFamily: fInter, fontSize: 11, color: C.textSec }}>{libelle}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>

    {/* AFFICHER button + densité toggle */}
    {hasAnyPOI && (
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{ ...primaryBtn(C.green, searchLoading), flex: 1 }} disabled={searchLoading} onClick={handleSearchPOI}>
          {searchLoading ? 'CHARGEMENT...' : 'AFFICHER LES POI SUR LA CARTE'}
        </button>
        <button
          title={densityMode ? 'Mode densité activé — cliquer pour repasser en marqueurs' : 'Passer en carte de densité'}
          onClick={() => onDensityModeChange?.(!densityMode)}
          style={{
            flexShrink: 0, padding: '0 10px',
            background: densityMode ? 'rgba(255,255,255,0.08)' : C.bgInput,
            border: `0.5px solid ${densityMode ? 'var(--text-primary)' : C.border}`,
            borderRadius: 4, cursor: 'pointer',
            fontFamily: fInter, fontSize: 12,
            color: densityMode ? 'var(--text-primary)' : C.textDim,
            whiteSpace: 'nowrap', transition: 'background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out)',
          }}
        >
          {densityMode ? '◉ Densité' : '◎ Densité'}
        </button>
      </div>
    )}

      </div>
      )}{/* fin collapsible POI content */}
    </div>
  );
}

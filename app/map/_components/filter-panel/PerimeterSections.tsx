'use client';

/**
 * Sections de la catégorie « Périmètre » du FilterPanel : périmètre global,
 * régions, départements, recherche locale, résumé du territoire et masque.
 *
 * Rendu par FilterPanel quand `visibleCategory` vaut 'perimeter' (overlay
 * Périmètre du rail /map). Le JSX est repris tel quel du monolithe
 * (2026-09-03) ; seule la résolution des variables change — de la fermeture
 * lexicale vers des props explicites.
 *
 * Props explicites plutôt qu'un contexte : 22 entrées restent lisibles et
 * typées, et le composant reste testable isolément.
 */

import React from 'react';
import type { RefDept, RefRegion } from '@/lib/geo/use-ref-geo';
import { CategoryGroup } from '@/components/ui/CategoryGroup';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { C, fInter, fMono } from './tokens';
import { inputFocusHandlers, inputStyle, labelStyle, pill } from './styles';

export interface PerimeterSectionsProps {
  /** Rendu en overlay du rail : pas d'en-tête ni de replier/déplier. */
  isOverlayMode: boolean;
  /** Terme de recherche du panneau — masque les sections qui ne matchent pas. */
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  scope: 'metro' | 'all' | null;
  selectScope: (s: 'metro' | 'all') => void;
  setScope: (
    next: 'metro' | 'all' | null | ((prev: 'metro' | 'all' | null) => 'metro' | 'all' | null),
  ) => void;

  selectedRegions: string[];
  setSelectedRegions: (next: string[] | ((prev: string[]) => string[])) => void;
  refRegions: RefRegion[];

  selectedDepts: string[];
  setSelectedDepts: (next: string[] | ((prev: string[]) => string[])) => void;
  availableDepts: RefDept[];

  ville: string;
  setVille: (next: string | ((prev: string) => string)) => void;
  codePostal: string;
  setCodePostal: (next: string) => void;

  territoire: string;
  hasTerritoire: boolean;

  adminScale: 'region' | 'departement' | null;
  adminCodes: string[];
  territoryMaskEnabled: boolean;
  setTerritoryMaskEnabled: (next: boolean) => void;
}

export function PerimeterSections({
  isOverlayMode,
  filterSearch,
  sectionsOpen,
  toggleSection,
  scope,
  selectScope,
  setScope,
  selectedRegions,
  setSelectedRegions,
  refRegions: REF_REGIONS,
  selectedDepts,
  setSelectedDepts,
  availableDepts,
  ville,
  setVille,
  codePostal,
  setCodePostal,
  territoire,
  hasTerritoire,
  adminScale,
  adminCodes,
  territoryMaskEnabled,
  setTerritoryMaskEnabled,
}: PerimeterSectionsProps) {
  return (
    <CategoryGroup title="Perimetre" color="var(--cat-context)" colorRgb="138,138,138" defaultOpen={isOverlayMode ? true : false} collapsible={!isOverlayMode} hideHeader={isOverlayMode}>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Scope global */}
        {(!filterSearch || 'périmètre global'.includes(filterSearch.toLowerCase())) && (
        <div>
          <FilterSectionHeader label="Périmètre global" sectionKey="perimetre" open={sectionsOpen.perimetre !== false} onToggle={() => toggleSection('perimetre')} count={scope ? 1 : 0} searchTerm={filterSearch} />
          {sectionsOpen.perimetre !== false && (
          <div style={{ marginBottom: 12, transition: 'opacity 150ms var(--ease-hover)', animation: 'fadeIn 200ms var(--ease-out)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ ...pill(scope === 'metro', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('metro')}>
              France Metro
            </button>
            <button style={{ ...pill(scope === 'all', C.green), flex: 1, textAlign: 'center' }} onClick={() => selectScope('all')}>
              France + DROM
            </button>
          </div>
          </div>
          )}
        </div>
        )}

        {/* Régions */}
        {(!filterSearch || 'région régions'.includes(filterSearch.toLowerCase())) && (
        <div>
          <FilterSectionHeader label="Régions" sectionKey="regions" open={sectionsOpen.regions !== false} onToggle={() => toggleSection('regions')} count={selectedRegions.length} searchTerm={filterSearch} />
          {sectionsOpen.regions !== false && (
          <div style={{ marginBottom: 12, animation: 'fadeIn 200ms var(--ease-out)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <button
              onClick={() => {
                const allCodes = REF_REGIONS.map(r => r.code_region);
                const allSelected = REF_REGIONS.length > 0 && selectedRegions.length === REF_REGIONS.length;
                setSelectedRegions(allSelected ? [] : allCodes);
                setScope(null);
              }}
              style={{ fontFamily: fInter, fontSize: 11, color: REF_REGIONS.length > 0 && selectedRegions.length === REF_REGIONS.length ? C.red : C.textSec, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {REF_REGIONS.length > 0 && selectedRegions.length === REF_REGIONS.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </button>
          </div>
          <MultiDropdown
            label={REF_REGIONS.length === 0 ? 'Chargement…' : 'Toutes les régions'}
            items={REF_REGIONS.map(r => ({ id: r.code_region, label: r.nom_region }))}
            selected={selectedRegions}
            onChange={codes => { setSelectedRegions(codes); if (codes.length > 0) setScope(null); }}
          />
          </div>
          )}
        </div>
        )}

        {/* Départements */}
        {(!filterSearch || 'département départements'.includes(filterSearch.toLowerCase())) && (
        <div>
          <FilterSectionHeader label="Départements" sectionKey="departements" open={sectionsOpen.departements !== false} onToggle={() => toggleSection('departements')} count={selectedDepts.length} searchTerm={filterSearch} />
          {sectionsOpen.departements !== false && (
          <div style={{ marginBottom: 12, animation: 'fadeIn 200ms var(--ease-out)' }}>
          <MultiDropdown
            label={availableDepts.length === 0 ? 'Chargement…' : 'Tous les départements'}
            items={availableDepts.map(d => ({ id: d.code_dept, label: `${d.code_dept} — ${d.nom_dept}` }))}
            selected={selectedDepts}
            onChange={codes => { setSelectedDepts(codes); if (codes.length > 0) setScope(null); }}
            searchable
          />
          {selectedRegions.length === 0 && (
            <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, marginTop: 4, fontStyle: 'italic' }}>
              Filtrer d&apos;abord par région
            </div>
          )}
          </div>
          )}
        </div>
        )}

        {/* Recherche locale */}
        {(!filterSearch || 'recherche locale ville'.includes(filterSearch.toLowerCase())) && (
        <div>
          <FilterSectionHeader label="Recherche locale" sectionKey="recherche" open={sectionsOpen.recherche !== false} onToggle={() => toggleSection('recherche')} count={(ville ? 1 : 0) + (codePostal ? 1 : 0)} searchTerm={filterSearch} />
          {sectionsOpen.recherche !== false && (
          <div style={{ marginBottom: 12, animation: 'fadeIn 200ms var(--ease-out)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ ...labelStyle, marginBottom: 4 }}>Ville</div>
              <input style={inputStyle} placeholder="ex: Brest" value={ville}
                onChange={e => { setVille(e.target.value); if (e.target.value) setScope(null); }} {...inputFocusHandlers} />
            </div>
            <div style={{ width: 80 }}>
              <div style={{ ...labelStyle, marginBottom: 4 }}>Code postal</div>
              <input style={inputStyle} placeholder="29200" value={codePostal}
                onChange={e => setCodePostal(e.target.value)} maxLength={5} {...inputFocusHandlers} />
            </div>
          </div>
          </div>
          )}
        </div>
        )}

        {/* Territoire summary */}
        {hasTerritoire && (
          <div style={{ padding: '10px 12px', background: C.greenDim, border: `0.5px solid rgba(61,255,160,0.2)`, borderRadius: 4 }}>
            <div style={{ fontFamily: fInter, fontSize: 11, fontWeight: 500, color: C.green, marginBottom: 4 }}>
              Territoire sélectionné
            </div>
            <div style={{ fontFamily: fInter, fontSize: 13, color: C.text, lineHeight: 1.4 }}>{territoire}</div>
            <button
              onClick={() => { setScope(null); setSelectedRegions([]); setSelectedDepts([]); setVille(''); setCodePostal(''); }}
              style={{ marginTop: 8, fontFamily: fInter, fontSize: 11, color: C.textDim, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ✕ Réinitialiser
            </button>
          </div>
        )}

        {/* Toggle territory mask : visible quand un filtre admin est actif */}
        {adminScale !== null && adminCodes.length > 0 && (
          <div style={{
            padding: '10px 12px',
            background: 'rgba(78,205,196,0.08)',
            borderLeft: '2px solid var(--brand-teal)',
            borderRadius: '0 4px 4px 0',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={territoryMaskEnabled}
                onChange={e => setTerritoryMaskEnabled(e.target.checked)}
                style={{ accentColor: 'var(--brand-teal)' }}
              />
              <span style={{ fontFamily: fInter, fontSize: 12, color: C.text }}>
                Afficher uniquement le territoire
              </span>
            </label>
            <p style={{ margin: '6px 0 0 22px', fontFamily: fInter, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>
              {adminScale === 'departement'
                ? 'Masque tout hors des départements selectionnes.'
                : adminScale === 'region'
                ? 'Masque tout hors des regions selectionnees.'
                : 'Masque tout hors du territoire selectionne.'}
            </p>
          </div>
        )}

      </div>
    </CategoryGroup>
  );
}

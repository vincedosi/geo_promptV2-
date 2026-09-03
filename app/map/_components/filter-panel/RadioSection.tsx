'use client';

/**
 * Section « Radio FM/DAB+ » de la catégorie Terrain : bascule de la couche
 * émetteurs, recherche et filtres (radios, catégories exclues, système), puis
 * réglages visuels de la couverture et du nuage de points.
 *
 * Toutes les valeurs viennent du parent /map (la couche vit dans
 * useRadioLayer) : ce composant ne porte aucun state.
 *
 * JSX repris tel quel du monolithe (2026-09-03).
 */

import React from 'react';
import { FilterSectionHeader } from './FilterSectionHeader';
import { MultiDropdown } from './MultiDropdown';
import { RadioSearchInput } from './RadioSearchInput';
import { C, fInter, fMono } from './tokens';

/** Catégories Arcom proposées à l'exclusion. */
const RADIO_EXCLUDABLE_CATEGORIES = [
  { id: 'D,E,P', label: 'Toutes nationales (D/E/P)' },
  { id: 'D', label: 'D — Thematiques nationales' },
  { id: 'E', label: 'E — Generalistes nationales' },
  { id: 'P', label: 'P — Service public' },
  { id: 'A', label: 'A — Associatives' },
  { id: 'B', label: 'B — Locales commerciales' },
  { id: 'C', label: 'C — Franchises locales' },
];

/** Systèmes de diffusion filtrables ('' = tous). */
const RADIO_SYSTEMS = [
  { label: 'Tous', value: '' },
  { label: 'FM', value: 'FM' },
  { label: 'DAB+', value: 'DAB+' },
];

/** Couleurs proposées pour les zones de couverture. */
const RADIO_COVERAGE_COLORS = ['var(--brand-teal)', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export interface RadioSectionProps {
  filterSearch: string;
  sectionsOpen: Record<string, boolean>;
  toggleSection: (key: string) => void;

  radioCount?: number;
  radioVisible?: boolean;
  onToggleRadio?: () => void;

  radioSelectedNom?: string | null;
  onClearRadioSelection?: () => void;
  onSelectRadio?: (radioId: string, radioNom: string) => void;

  radioFilterOptions?: {
    radios: Array<{ id: string; nom: string; cat: string | null }>;
    categories: Array<{ value: string; label: string }>;
  } | null;
  radioFilterIds?: string[];
  onRadioFilterIdsChange?: (ids: string[]) => void;
  radioExcludeCategories?: string[];
  onRadioExcludeCategoriesChange?: (cats: string[]) => void;
  radioSystemeFilter?: string;
  onRadioSystemeChange?: (v: string) => void;

  radioCoverageMode?: boolean;
  onToggleRadioCoverage?: () => void;
  radioCoverageColor?: string;
  onRadioCoverageColorChange?: (c: string) => void;
  radioCoverageOpacity?: number;
  onRadioCoverageOpacityChange?: (v: number) => void;
  radioBorderWidth?: number;
  onRadioBorderWidthChange?: (v: number) => void;

  radioHeatmapMode?: boolean;
  onToggleRadioHeatmap?: () => void;
  radioPointSize?: number;
  onRadioPointSizeChange?: (v: number) => void;

  onRecenterFrance?: () => void;
}

export function RadioSection({
  filterSearch,
  sectionsOpen,
  toggleSection,
  radioCount,
  radioVisible,
  onToggleRadio,
  radioSelectedNom,
  onClearRadioSelection,
  onSelectRadio,
  radioFilterOptions,
  radioFilterIds,
  onRadioFilterIdsChange,
  radioExcludeCategories,
  onRadioExcludeCategoriesChange,
  radioSystemeFilter,
  onRadioSystemeChange,
  radioCoverageMode,
  onToggleRadioCoverage,
  radioCoverageColor,
  onRadioCoverageColorChange,
  radioCoverageOpacity,
  onRadioCoverageOpacityChange,
  radioBorderWidth,
  onRadioBorderWidthChange,
  radioHeatmapMode,
  onToggleRadioHeatmap,
  radioPointSize,
  onRadioPointSizeChange,
  onRecenterFrance,
}: RadioSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FilterSectionHeader label="Radio FM/DAB+" sectionKey="radio" open={sectionsOpen.radio !== false} onToggle={() => toggleSection('radio')} count={radioCount} searchTerm={filterSearch} />
      {sectionsOpen.radio !== false && (
      <div style={{ animation: 'fadeIn 200ms var(--ease-out)' }}>

      {/* Selected radio banner */}
      {radioSelectedNom && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(78,205,196,0.08)', border: '0.5px solid rgba(78,205,196,0.2)',
          borderRadius: 6, padding: '6px 10px', fontSize: 11,
        }}>
          <span style={{ color: 'var(--brand-teal)', flex: 1, fontWeight: 500, fontFamily: fInter }}>
            📻 {radioSelectedNom}
          </span>
          <button onClick={onClearRadioSelection} style={{
            background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
            fontSize: 14, padding: 0, lineHeight: 1, transition: 'color 150ms var(--ease-hover)',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >×</button>
        </div>
      )}

      {/* Main toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onToggleRadio}
          style={{
            flex: 1, padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            fontFamily: fInter, cursor: 'pointer', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
            background: radioVisible ? 'rgba(78,205,196,0.1)' : 'transparent',
            border: `0.5px solid ${radioVisible ? 'var(--brand-teal)' : 'var(--border-default)'}`,
            color: radioVisible ? 'var(--brand-teal)' : C.textSec,
          }}
        >
          {radioVisible ? '📻 Émetteurs visibles' : '📻 Afficher les émetteurs'}
        </button>
      </div>

      {/* Sub-layer toggles + filters + visual controls */}
      {radioVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Radio search */}
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Rechercher une radio</div>
            <RadioSearchInput onSelect={(id, nom) => onSelectRadio?.(id, nom)} />
          </div>

          {/* Multi-radio filter — searchable, multi-select */}
          {Array.isArray(radioFilterOptions?.radios) && radioFilterOptions!.radios.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>
                Filtrer par radios
                <span style={{ color: C.textDim, marginLeft: 4, fontFamily: fMono }}>({radioFilterOptions!.radios.length})</span>
              </div>
              <MultiDropdown
                label="Sélectionner des radios..."
                items={radioFilterOptions!.radios.map(r => ({ id: r.id, label: `${r.nom}${r.cat ? ` (${r.cat})` : ''}` }))}
                selected={radioFilterIds ?? []}
                onChange={ids => onRadioFilterIdsChange?.(ids)}
                searchable
              />
            </div>
          )}

          {/* Exclude categories */}
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Exclure des categories</div>
            <MultiDropdown
              label="Aucune exclusion"
              items={RADIO_EXCLUDABLE_CATEGORIES}
              selected={radioExcludeCategories ?? []}
              onChange={cats => onRadioExcludeCategoriesChange?.(cats)}
            />
          </div>

          {/* System filter */}
          <div>
            <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>Système</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {RADIO_SYSTEMS.map(opt => (
                <button key={opt.value} onClick={() => onRadioSystemeChange?.(opt.value)} style={{
                  flex: 1, padding: '4px 0', borderRadius: 4, fontSize: 10, fontFamily: fInter,
                  background: radioSystemeFilter === opt.value ? 'rgba(78,205,196,0.1)' : 'transparent',
                  border: `0.5px solid ${radioSystemeFilter === opt.value ? 'var(--brand-teal)' : 'var(--border-default)'}`,
                  color: radioSystemeFilter === opt.value ? 'var(--brand-teal)' : C.textDim,
                  cursor: 'pointer', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)',
                }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 8 }} />

          {/* Layer toggles */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.textSec }}>
            <input type="checkbox" checked={radioCoverageMode} onChange={() => onToggleRadioCoverage?.()} style={{ accentColor: 'var(--brand-teal)' }} />
            Zones de couverture
          </label>

          {/* Coverage controls (visible when coverage on) */}
          {radioCoverageMode && (
            <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 9, color: C.textDim, fontStyle: 'italic', marginBottom: 2 }}>Couverture estimée (approximation)</div>

              {/* Color picker */}
              <div>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>Couleur</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {RADIO_COVERAGE_COLORS.map(c => (
                    <button key={c} onClick={() => onRadioCoverageColorChange?.(c)} style={{
                      width: 16, height: 16, borderRadius: '50%', background: c, border: radioCoverageColor === c ? '2px solid var(--text-primary)' : '1px solid var(--border-hover)',
                      cursor: 'pointer', transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)', flexShrink: 0,
                    }} />
                  ))}
                  <input type="color" value={radioCoverageColor ?? 'var(--brand-teal)'} onChange={e => onRadioCoverageColorChange?.(e.target.value)} style={{ width: 16, height: 16, border: 'none', padding: 0, cursor: 'pointer', background: 'transparent' }} />
                </div>
              </div>

              {/* Opacity slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                  <span>Opacité</span>
                  <span style={{ fontFamily: fMono, color: C.textSec }}>{radioCoverageOpacity}%</span>
                </div>
                <input type="range" min={0} max={100} step={5} value={radioCoverageOpacity ?? 15}
                  onChange={e => onRadioCoverageOpacityChange?.(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
              </div>

              {/* Border width */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
                  <span>Contour</span>
                  <span style={{ fontFamily: fMono, color: C.textSec }}>{radioBorderWidth}px</span>
                </div>
                <input type="range" min={0} max={5} step={0.5} value={radioBorderWidth ?? 0.5}
                  onChange={e => onRadioBorderWidthChange?.(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
              </div>
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: C.textSec }}>
            <input type="checkbox" checked={radioHeatmapMode} onChange={() => onToggleRadioHeatmap?.()} style={{ accentColor: 'var(--brand-teal)' }} />
            Densité (heatmap)
          </label>

          {/* Point size */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, marginBottom: 2 }}>
              <span>Taille points</span>
              <span style={{ fontFamily: fMono, color: C.textSec }}>{radioPointSize}px</span>
            </div>
            <input type="range" min={2} max={12} step={1} value={radioPointSize ?? 5}
              onChange={e => onRadioPointSizeChange?.(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--brand-teal)', height: 4, cursor: 'pointer' }} />
          </div>

          <div style={{ borderTop: '0.5px solid var(--border-subtle)', paddingTop: 6 }}>
            <button onClick={onRecenterFrance} style={{
              background: 'transparent', border: '0.5px solid var(--border-default)', borderRadius: 6,
              padding: '5px 12px', fontSize: 10, color: C.textDim, cursor: 'pointer',
              fontFamily: fInter, transition: 'background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover), opacity 150ms var(--ease-hover)', width: '100%',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = C.textDim; }}
            >
              Recentrer France
            </button>
          </div>
        </div>
      )}

      <div style={{ fontFamily: fMono, fontSize: 9, color: C.muted, fontStyle: 'italic' }}>
        Source : ANFR data.gouv.fr
      </div>
      </div>
      )}{/* fin collapsible radio */}
    </div>
  );
}

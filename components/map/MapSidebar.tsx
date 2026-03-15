'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Panel, FilterState } from '@/lib/map/types';
import { useMapPanels } from './hooks/useMapPanels';
import { COLORS, SIDEBAR_CONFIG } from '@/lib/map/config';
import { truncateText, getPanelType } from '@/lib/map/utils';

interface MapSidebarProps {
  panels: Panel[];
  selectedPanel?: Panel | null;
  onPanelSelect?: (panel: Panel) => void;
  onFilterChange?: (filters: FilterState) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
}

export default function MapSidebar({
  panels,
  selectedPanel,
  onPanelSelect,
  onFilterChange,
  isCollapsed = false,
  onToggleCollapse,
}: MapSidebarProps) {
  const [showFilters, setShowFilters] = useState(true);
  const {
    filteredPanels,
    filters,
    updateFilters,
    togglePanelType,
    clearFilters,
    cities,
    departments,
    panelTypes,
    totalCount,
    filteredCount,
  } = useMapPanels(panels);

  // Notify parent of filter changes
  const handleFilterChange = useCallback((newFilters: Partial<FilterState>) => {
    updateFilters(newFilters);
    if (onFilterChange) {
      onFilterChange({ ...filters, ...newFilters });
    }
  }, [filters, updateFilters, onFilterChange]);

  const handlePanelTypeToggle = useCallback((type: string) => {
    togglePanelType(type);
    handleFilterChange({
      ...filters,
      panelTypes: filters.panelTypes?.includes(type)
        ? filters.panelTypes.filter((t) => t !== type)
        : [...(filters.panelTypes || []), type],
    });
  }, [filters, togglePanelType, handleFilterChange]);

  if (isCollapsed) {
    return (
      <button
        onClick={() => onToggleCollapse?.(false)}
        className="fixed left-0 top-4 z-30 bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-r-lg border border-l-0 border-slate-700 transition-colors"
        title="Open filters"
      >
        ☰
      </button>
    );
  }

  return (
    <div
      className="flex flex-col h-full rounded-lg border border-slate-700 overflow-hidden"
      style={{
        width: `${SIDEBAR_CONFIG.width}px`,
        backgroundColor: COLORS.bg.secondary,
        color: COLORS.text.primary,
      }}
    >
      {/* Header */}
      <div
        className="border-b border-slate-700 p-4 flex items-center justify-between"
        style={{ backgroundColor: COLORS.bg.tertiary }}
      >
        <Link
          href="/"
          className="text-sm font-semibold text-accent-blue hover:text-accent-cyan transition-colors flex items-center gap-2"
        >
          ← Nouveau prompt
        </Link>
        <button
          onClick={() => onToggleCollapse?.(true)}
          className="text-white transition-colors"
          title="Close filters"
        >
          ✕
        </button>
      </div>

      {/* Stats */}
      <div
        className="px-4 py-3 text-xs border-b border-slate-700"
        style={{ backgroundColor: COLORS.bg.primary }}
      >
        <p className="text-white">
          <span className="font-semibold text-accent-blue">
            {filteredCount}
          </span>{' '}
          / {totalCount} panneaux
        </p>
      </div>

      {/* Filters Section */}
      <div className="flex-shrink-0 border-b border-slate-700">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full px-4 py-3 text-left text-sm font-semibold hover:bg-slate-700 transition-colors flex items-center justify-between"
          style={{ backgroundColor: COLORS.bg.tertiary }}
        >
          <span>Filtres</span>
          <span className="text-xs">{showFilters ? '▼' : '▶'}</span>
        </button>

        {showFilters && (
          <div className="px-4 py-3 space-y-4">
            {/* Panel Types */}
            {panelTypes.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-white uppercase block mb-2">
                  Type de panneau
                </label>
                <div className="space-y-2">
                  {panelTypes.map((type) => (
                    <label key={type} className="flex items-center text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.panelTypes?.includes(type as string) || false}
                        onChange={() => handlePanelTypeToggle(type as string)}
                        className="w-4 h-4 mr-2"
                      />
                      <span className="text-white transition-colors">
                        {type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Cities */}
            {cities.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-white uppercase block mb-2">
                  Ville
                </label>
                <select
                  value={filters.city || ''}
                  onChange={(e) =>
                    handleFilterChange({ city: e.target.value || undefined })
                  }
                  className="w-full px-2 py-1 text-sm rounded bg-slate-800 border border-slate-700 text-white"
                >
                  <option value="">Toutes les villes</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Clear Filters */}
            <button
              onClick={() => {
                clearFilters();
                handleFilterChange({ panelTypes: [] });
              }}
              className="w-full px-2 py-1 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors"
            >
              Réinitialiser
            </button>
          </div>
        )}
      </div>

      {/* Panel List */}
      <div className="flex-1 overflow-y-auto">
        {filteredPanels.length === 0 ? (
          <div className="p-4 text-center text-white text-sm">
            Aucun panneau correspondant aux filtres
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {filteredPanels.map((panel) => (
              <button
                key={panel.id}
                onClick={() => onPanelSelect?.(panel)}
                className={`w-full text-left px-4 py-3 transition-colors text-sm border-none cursor-pointer group ${
                  selectedPanel?.id === panel.id
                    ? 'bg-slate-700/50 border-l-4 border-accent-blue'
                    : 'hover:bg-slate-700'
                }`}
              >
                <p className={`font-semibold transition-colors ${
                  selectedPanel?.id === panel.id
                    ? 'text-accent-blue'
                    : 'text-white group-hover:text-accent-blue'
                }`}>
                  {truncateText(panel.nom || 'Panel', 28)}
                </p>
                <p className="text-xs text-white mt-1">
                  {panel.ville} • {getPanelType(panel)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

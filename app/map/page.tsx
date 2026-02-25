'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import AISearchInput from '@/app/components/AISearchInput';

// Import dynamique : maplibre-gl a besoin du DOM (pas de SSR)
const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a' }}>
      <p style={{ color: '#888', fontFamily: 'Inter, sans-serif' }}>Chargement de la carte...</p>
    </div>
  ),
});

interface POI {
  id: string;
  nom: string;
  lat: number;
  lng: number;
  categorie: string;
  sous_categorie?: string;
  adresse?: string;
  ville?: string;
  region?: string;
  departement?: string;
  code_departement?: string;
  code_postal?: string;
  date_import?: string;
  organization_id?: string;
  data_source_id?: string;
  metadata?: any;
}

export default function MapPage() {
  const [pois, setPois] = useState<POI[]>([]);
  const [poisRaw, setPoisRaw] = useState<POI[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [poiCategories, setPoiCategories] = useState<Record<string, boolean>>({});
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Source-based filters
  interface SourceFilter {
    name: string;
    category: string;
    filterFields: string[];
    filterValues: Record<string, string[]>;
  }
  const [sourceFilters, setSourceFilters] = useState<Record<string, SourceFilter>>({});
  const [sourceFilterSelections, setSourceFilterSelections] = useState<Record<string, Record<string, string>>>({});

  // AI direct filters (multi-value support)
  const [aiDirectFilters, setAiDirectFilters] = useState<Record<string, string | string[]>>({});

  // Load source filters on mount
  useEffect(() => {
    const loadSourceFilters = async () => {
      try {
        const response = await fetch('/api/admin/source-filters');
        const data = await response.json();

        if (data.success && data.sourceFilters) {
          setSourceFilters(data.sourceFilters);

          const selections: Record<string, Record<string, string>> = {};
          Object.entries(data.sourceFilters).forEach(([sourceId, filter]: [string, any]) => {
            selections[sourceId] = {};
            filter.filterFields?.forEach((field: string) => {
              selections[sourceId][field] = '';
            });
          });
          setSourceFilterSelections(selections);
        }
      } catch (err) {
        console.error('[MapPage] Error loading source filters:', err);
      }
    };
    loadSourceFilters();
  }, []);

  // Load categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch('/api/search-poi/categories');
        const data = await response.json();

        if (data.success) {
          const categories = data.categories || [];
          setAvailableCategories(categories);
          const categoriesState: Record<string, boolean> = {};
          categories.forEach((cat: string) => {
            categoriesState[cat] = categories.length === 1;
          });
          setPoiCategories(categoriesState);
        }
      } catch (err) {
        console.error('[MapPage] Error loading categories:', err);
      }
    };
    loadCategories();
  }, []);

  // Load POIs when categories change
  useEffect(() => {
    const loadPois = async () => {
      const selectedCategories = Object.keys(poiCategories).filter((cat) => poiCategories[cat]);

      if (selectedCategories.length === 0) {
        setPoisRaw([]);
        setPois([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch('/api/search-poi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: selectedCategories, limit: 1000 }),
        });

        const data = await response.json();
        if (data.pois) {
          setPoisRaw(data.pois);
          setPois(data.pois);
        }
      } catch (err) {
        console.error('[MapPage] Error loading POIs:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadPois();
  }, [poiCategories]);

  // Apply filters to POIs (geo = OR, non-geo = AND)
  useEffect(() => {
    if (poisRaw.length === 0) {
      setPois(poisRaw);
      return;
    }

    // Collect all active filters
    const activeFilters: Record<string, string | string[]> = {};
    Object.values(sourceFilterSelections).forEach((fieldsMap) => {
      Object.entries(fieldsMap).forEach(([field, value]) => {
        if (value && value !== '') activeFilters[field] = value;
      });
    });
    if (aiDirectFilters) {
      Object.entries(aiDirectFilters).forEach(([field, value]) => {
        if (value && value !== '') activeFilters[field] = value;
      });
    }

    if (Object.keys(activeFilters).length === 0) {
      setPois(poisRaw);
      return;
    }

    const genesisFields = ['nom', 'adresse', 'ville', 'region', 'code_postal', 'departement', 'code_departement', 'sous_categorie'];
    const geoFields = new Set(['ville', 'region', 'departement', 'code_departement', 'code_postal']);

    // Split into geo (OR) and non-geo (AND) filters
    const geoFilters: [string, string | string[]][] = [];
    const nonGeoFilters: [string, string | string[]][] = [];
    Object.entries(activeFilters).forEach(([field, value]) => {
      const nf = field.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (geoFields.has(nf)) {
        geoFilters.push([field, value]);
      } else {
        nonGeoFilters.push([field, value]);
      }
    });

    const poiMatchesFilter = (poi: POI, field: string, selectedValue: string | string[]): boolean => {
      const selectedValues = Array.isArray(selectedValue) ? selectedValue : [selectedValue];
      let poiValue: any = null;
      const normalizedField = field.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const matchedField = genesisFields.find((gf) => gf.toLowerCase() === normalizedField);

      if (matchedField) {
        poiValue = (poi as any)[matchedField];
      } else {
        if (!poi.metadata) return false;
        try {
          const metadata = typeof poi.metadata === 'string' ? JSON.parse(poi.metadata) : poi.metadata;
          poiValue = metadata?.[field];
          if (!poiValue) {
            const metaKey = Object.keys(metadata || {}).find(
              (k) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalizedField
            );
            if (metaKey) poiValue = metadata[metaKey];
          }
        } catch {
          return false;
        }
      }

      if (!poiValue) return false;
      const poiStr = String(poiValue);

      return selectedValues.some(sv => {
        if (normalizedField === 'code_postal') {
          return poiStr.startsWith(sv) || sv.startsWith(poiStr);
        }
        return poiStr === sv;
      });
    };

    const filteredPois = poisRaw.filter((poi) => {
      const nonGeoMatch = nonGeoFilters.every(([f, v]) => poiMatchesFilter(poi, f, v));
      if (!nonGeoMatch) return false;
      if (geoFilters.length === 0) return true;
      return geoFilters.some(([f, v]) => poiMatchesFilter(poi, f, v));
    });

    console.log(`[MapPage] Filtered: ${poisRaw.length} → ${filteredPois.length}`);
    setPois(filteredPois);
  }, [sourceFilterSelections, aiDirectFilters, poisRaw]);

  // Normalize helper
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  // Handle AI search
  const handleAISearch = (categories: string[], filters: Record<string, string | string[]>) => {
    console.log('[MapPage] AI Search:', { categories, filters });

    // Update categories
    setPoiCategories((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((cat) => { updated[cat] = false; });

      if (categories.length === 0) {
        Object.keys(updated).forEach((cat) => { updated[cat] = true; });
      } else {
        categories.forEach((category) => {
          const matched = Object.keys(updated).find((cat) => normalize(cat) === normalize(category));
          if (matched) {
            updated[matched] = true;
          } else {
            updated[category] = true;
          }
        });
      }
      return updated;
    });

    // Apply filters
    if (Object.keys(filters).length > 0) {
      const newSelections: Record<string, Record<string, string>> = {};
      Object.entries(sourceFilterSelections).forEach(([sourceId, fields]) => {
        newSelections[sourceId] = { ...fields };
      });

      const newDirectFilters: Record<string, string | string[]> = {};

      Object.entries(filters).forEach(([fieldName, fieldValue]) => {
        const normalizedFieldName = normalize(fieldName);
        const isMultiValue = Array.isArray(fieldValue);

        if (isMultiValue) {
          newDirectFilters[fieldName] = fieldValue;
          return;
        }

        let foundSource = false;
        Object.entries(sourceFilters).forEach(([sourceId, filter]) => {
          const matchedField = filter.filterFields.find(
            (f: string) => normalize(f) === normalizedFieldName
          );
          if (matchedField) {
            if (!newSelections[sourceId]) newSelections[sourceId] = {};
            const availableValues = filter.filterValues[matchedField] || [];
            const normalizedFV = normalize(fieldValue as string);
            let bestMatch = availableValues.find((v: string) => v === fieldValue);
            if (!bestMatch) bestMatch = availableValues.find((v: string) => normalize(v) === normalizedFV);
            if (!bestMatch) bestMatch = availableValues.find((v: string) => normalize(v).includes(normalizedFV) || normalizedFV.includes(normalize(v)));

            newSelections[sourceId][matchedField] = bestMatch || (fieldValue as string);
            foundSource = true;
          }
        });

        if (!foundSource) {
          newDirectFilters[fieldName] = fieldValue;
        }
      });

      setSourceFilterSelections(newSelections);
      setAiDirectFilters(newDirectFilters);
    } else {
      setAiDirectFilters({});
    }
  };

  // Collect all available filter values for AI context
  const allFilterValues: Record<string, string[]> = {};
  Object.values(sourceFilters).forEach((filter) => {
    Object.entries(filter.filterValues).forEach(([field, values]) => {
      if (!allFilterValues[field]) allFilterValues[field] = [];
      allFilterValues[field] = [...new Set([...allFilterValues[field], ...values])];
    });
  });

  const toggleCategory = (category: string) => {
    setPoiCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  const handleSourceFilterChange = (sourceId: string, field: string, value: string) => {
    setSourceFilterSelections((prev) => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], [field]: value },
    }));
    // Clear AI direct filters when user manually changes dropdowns
    setAiDirectFilters({});
  };

  const selectedCount = Object.keys(poiCategories).filter(c => poiCategories[c]).length;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0a0a' }}>
      {/* Sidebar */}
      <div
        style={{
          width: sidebarCollapsed ? '40px' : '280px',
          transition: 'width 0.3s ease',
          background: '#111118',
          borderRight: '1px solid rgba(99, 102, 241, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Collapse button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a5b4fc',
            cursor: 'pointer',
            padding: '12px',
            fontSize: '16px',
            textAlign: sidebarCollapsed ? 'center' : 'right',
          }}
        >
          {sidebarCollapsed ? '▸' : '◂'}
        </button>

        {!sidebarCollapsed && (
          <div style={{ padding: '0 16px 16px', overflow: 'auto', flex: 1 }}>
            <h3 style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '1.5px',
              color: '#64748b',
              marginBottom: '12px',
              fontFamily: 'Inter, sans-serif',
            }}>
              FILTRES
            </h3>

            {/* Categories */}
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{
                fontSize: '11px',
                textTransform: 'uppercase' as const,
                letterSpacing: '1px',
                color: '#94a3b8',
                marginBottom: '8px',
                fontFamily: 'Inter, sans-serif',
              }}>
                Type d&apos;établissement
              </h4>
              {availableCategories.map((cat) => (
                <label
                  key={cat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    cursor: 'pointer',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={poiCategories[cat] || false}
                      onChange={() => toggleCategory(cat)}
                      style={{ accentColor: '#6366f1' }}
                    />
                    {cat.toUpperCase()}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>
                    {poiCategories[cat] ? pois.filter(p => p.categorie === cat).length : ''}
                  </span>
                </label>
              ))}
            </div>

            {/* Source Filters (dropdowns) */}
            {Object.entries(sourceFilters).map(([sourceId, filter]) => {
              if (!filter.filterFields || filter.filterFields.length === 0) return null;
              return (
                <div key={sourceId} style={{ marginBottom: '16px' }}>
                  <h4 style={{
                    fontSize: '11px',
                    textTransform: 'uppercase' as const,
                    letterSpacing: '1px',
                    color: '#94a3b8',
                    marginBottom: '8px',
                    fontFamily: 'Inter, sans-serif',
                    borderLeft: '2px solid #6366f1',
                    paddingLeft: '8px',
                  }}>
                    {filter.name}
                  </h4>
                  {filter.filterFields.map((field: string) => (
                    <div key={field} style={{ marginBottom: '8px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '10px',
                        color: '#64748b',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.5px',
                        marginBottom: '4px',
                        fontFamily: 'Inter, sans-serif',
                      }}>
                        {field}
                      </label>
                      <select
                        value={sourceFilterSelections[sourceId]?.[field] || ''}
                        onChange={(e) => handleSourceFilterChange(sourceId, field, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          background: '#1a1a2e',
                          border: '1px solid rgba(99, 102, 241, 0.2)',
                          borderRadius: '6px',
                          color: '#e2e8f0',
                          fontSize: '12px',
                          fontFamily: 'Inter, sans-serif',
                          outline: 'none',
                        }}
                      >
                        <option value="">-- Tous --</option>
                        {(filter.filterValues[field] || []).map((val: string) => (
                          <option key={val} value={val}>{val}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Main content: search bar + map */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* AI Search - above map */}
        <AISearchInput
          onSearch={handleAISearch}
          availableCategories={availableCategories}
          availableFilterValues={allFilterValues}
          isLoading={isLoading}
        />

        {/* Status bar */}
        <div style={{
          padding: '4px 16px',
          background: '#0f172a',
          borderBottom: '1px solid rgba(99, 102, 241, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: '#64748b',
          fontFamily: 'monospace',
        }}>
          <span>{pois.length} POI{pois.length !== 1 ? 's' : ''} affichés • {selectedCount} catégorie{selectedCount !== 1 ? 's' : ''}</span>
          {isLoading && <span style={{ color: '#f59e0b' }}>⟳ Chargement...</span>}
        </div>

        {/* Map */}
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer pois={pois} />
        </div>
      </div>

      {/* CSS animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

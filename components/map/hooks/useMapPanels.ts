/**
 * Hook for managing panel data, filtering, and sync with map
 */

import { useState, useCallback, useEffect } from 'react';
import { Panel, FilterState } from '@/lib/map/types';
import {
  getPanelLat,
  getPanelLng,
  filterValidPanels,
  filterPanelsByBbox,
} from '@/lib/map/utils';

export function useMapPanels(initialPanels: Panel[]) {
  const [panels, setPanels] = useState<Panel[]>(filterValidPanels(initialPanels));
  const [filteredPanels, setFilteredPanels] = useState<Panel[]>(panels);
  const [filters, setFilters] = useState<FilterState>({
    panelTypes: [],
  });
  const [visibleBbox, setVisibleBbox] = useState<
    [number, number, number, number] | null
  >(null);

  // Update panels when initial data changes
  useEffect(() => {
    const validPanels = filterValidPanels(initialPanels);
    setPanels(validPanels);
  }, [initialPanels]);

  // Apply filters
  useEffect(() => {
    let result = [...panels];

    // Filter by panel types
    if (filters.panelTypes && filters.panelTypes.length > 0) {
      result = result.filter((panel) => {
        const type = panel.format || panel.type || panel.categorie || '';
        return filters.panelTypes.includes(type);
      });
    }

    // Filter by city
    if (filters.city) {
      result = result.filter(
        (panel) => panel.ville?.toLowerCase() === filters.city?.toLowerCase()
      );
    }

    // Filter by department
    if (filters.department) {
      result = result.filter((panel) => panel.department === filters.department);
    }

    // Filter by availability
    if (filters.available !== undefined) {
      result = result.filter((panel) => panel.available === filters.available);
    }

    // Filter by minimum score
    if (filters.minScore !== undefined && filters.minScore > 0) {
      result = result.filter((panel) => (panel.score || 0) >= filters.minScore!);
    }

    // Filter by visible bbox (for performance)
    if (visibleBbox) {
      result = filterPanelsByBbox(result, visibleBbox);
    }

    setFilteredPanels(result);
  }, [panels, filters, visibleBbox]);

  // Update filter state
  const updateFilters = useCallback((newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  // Toggle panel type filter
  const togglePanelType = useCallback((type: string) => {
    setFilters((prev) => {
      const types = prev.panelTypes || [];
      const isIncluded = types.includes(type);
      return {
        ...prev,
        panelTypes: isIncluded
          ? types.filter((t) => t !== type)
          : [...types, type],
      };
    });
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFilters({
      panelTypes: [],
    });
    setVisibleBbox(null);
  }, []);

  // Get unique cities
  const cities: string[] = Array.from(
    new Set(panels.map((p) => p.ville).filter((v): v is string => !!v))
  ).sort();

  // Get unique departments
  const departments: string[] = Array.from(
    new Set(panels.map((p) => p.department).filter((v): v is string => !!v))
  ).sort();

  // Get unique panel types
  const panelTypes: string[] = Array.from(
    new Set(
      panels
        .map((p) => p.format || p.type || p.categorie)
        .filter((v): v is string => !!v)
    )
  ).sort();

  return {
    panels,
    filteredPanels,
    filters,
    updateFilters,
    togglePanelType,
    clearFilters,
    setVisibleBbox,
    cities,
    departments,
    panelTypes,
    totalCount: panels.length,
    filteredCount: filteredPanels.length,
  };
}

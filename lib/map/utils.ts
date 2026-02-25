/**
 * Utility functions for map operations
 */

import { Panel, GeoJSONFeatureCollection, ClusterFeature } from './types';

/**
 * Extract latitude from panel (handles both formats)
 */
export function getPanelLat(panel: Panel): number | null {
  return panel.latitude || panel.lat || null;
}

/**
 * Extract longitude from panel (handles both formats)
 */
export function getPanelLng(panel: Panel): number | null {
  return panel.longitude || panel.lng || null;
}

/**
 * Check if panel has valid coordinates
 */
export function hasValidCoordinates(panel: Panel): boolean {
  const lat = getPanelLat(panel);
  const lng = getPanelLng(panel);
  return lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);
}

/**
 * Filter panels with valid coordinates
 */
export function filterValidPanels(panels: Panel[]): Panel[] {
  return panels.filter(hasValidCoordinates);
}

/**
 * Convert panels to GeoJSON FeatureCollection
 */
export function panelsToGeoJSON(panels: Panel[]): GeoJSONFeatureCollection {
  const validPanels = filterValidPanels(panels);

  const features: ClusterFeature[] = validPanels.map((panel, index) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [getPanelLng(panel)!, getPanelLat(panel)!],
    },
    properties: {
      cluster: false,
    },
    id: panel.id || index,
  }));

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Calculate distance between two points (Haversine formula)
 * Returns distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Get color based on cluster size (low → blue, medium → orange, high → red)
 */
export function getClusterColor(pointCount: number): string {
  if (pointCount < 50) return '#3b82f6';      // Blue - Low
  if (pointCount < 200) return '#f59e0b';    // Orange - Medium
  return '#ef4444';                          // Red - High
}

/**
 * Format panel count for cluster display
 */
export function formatClusterLabel(count: number): string {
  if (count < 1000) return count.toString();
  return (count / 1000).toFixed(1) + 'k';
}

/**
 * Get panel type label from panel data
 */
export function getPanelType(panel: Panel): string {
  return panel.format || panel.type || panel.categorie || 'Panel';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Check if point is within bbox
 */
export function isPointInBbox(
  lat: number,
  lng: number,
  bbox: [number, number, number, number]
): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Filter panels by bounding box (for viewport filtering)
 */
export function filterPanelsByBbox(
  panels: Panel[],
  bbox: [number, number, number, number]
): Panel[] {
  return panels.filter((panel) => {
    const lat = getPanelLat(panel);
    const lng = getPanelLng(panel);
    if (lat === null || lng === null) return false;
    return isPointInBbox(lat, lng, bbox);
  });
}

/**
 * Get panel display name
 */
export function getPanelName(panel: Panel): string {
  return panel.nom || panel.nom_site || `Panel ${panel.id}`;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Format panel info for popup
 */
export function formatPanelInfo(panel: Panel): Record<string, string> {
  return {
    Name: getPanelName(panel),
    Type: getPanelType(panel),
    City: panel.ville || '-',
    Region: panel.region || '-',
    Operator: panel.regie || '-',
    Format: panel.format || '-',
  };
}

/**
 * Get expansion zoom for cluster
 */
export function getExpansionZoom(
  clusterZoom: number,
  pointCount: number
): number {
  if (pointCount < 10) return clusterZoom + 2;
  if (pointCount < 50) return clusterZoom + 1;
  return clusterZoom;
}

/**
 * Calculate zoom level for bounding box
 */
export function calculateZoomFromBbox(
  bbox: [number, number, number, number],
  width: number,
  height: number
): number {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const maxLngSpan = 360;
  const lngSpan = maxLng - minLng;

  // Rough zoom calculation
  const zoomX = Math.floor(Math.log2(maxLngSpan / lngSpan));
  const latSpan = maxLat - minLat;
  const zoomY = Math.floor(Math.log2(width / (64 * latSpan)));

  return Math.max(0, Math.min(28, Math.min(zoomX, zoomY)));
}

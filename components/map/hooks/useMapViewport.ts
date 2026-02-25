/**
 * Hook for managing map viewport state
 */

import { useState, useCallback } from 'react';
import { MapViewport } from '@/lib/map/types';
import { INITIAL_VIEWPORT } from '@/lib/map/config';

export function useMapViewport() {
  const [viewport, setViewport] = useState<MapViewport>(INITIAL_VIEWPORT);

  // Update viewport
  const updateViewport = useCallback((newViewport: Partial<MapViewport>) => {
    setViewport((prev) => ({
      ...prev,
      ...newViewport,
    }));
  }, []);

  // Fly to location
  const flyTo = useCallback((location: Partial<MapViewport>) => {
    updateViewport({
      latitude: location.latitude || viewport.latitude,
      longitude: location.longitude || viewport.longitude,
      zoom: location.zoom || viewport.zoom,
      bearing: location.bearing || 0,
      pitch: location.pitch || 0,
    });
  }, [viewport, updateViewport]);

  // Reset to initial
  const resetViewport = useCallback(() => {
    setViewport(INITIAL_VIEWPORT);
  }, []);

  // Zoom in
  const zoomIn = useCallback(() => {
    updateViewport({
      zoom: Math.min(viewport.zoom + 1, 18),
    });
  }, [viewport.zoom, updateViewport]);

  // Zoom out
  const zoomOut = useCallback(() => {
    updateViewport({
      zoom: Math.max(viewport.zoom - 1, 3),
    });
  }, [viewport.zoom, updateViewport]);

  // Get bounding box from viewport
  const getBbox = useCallback((): [number, number, number, number] => {
    const zoom = viewport.zoom;
    const scale = Math.pow(2, zoom);
    const unitsPerPixel = 360 / (256 * scale);

    // Assuming a standard viewport width/height of 1000x600 pixels
    const width = 1000;
    const height = 600;

    const minLng = viewport.longitude - (width / 2) * unitsPerPixel;
    const maxLng = viewport.longitude + (width / 2) * unitsPerPixel;
    const minLat = viewport.latitude - (height / 2) * unitsPerPixel;
    const maxLat = viewport.latitude + (height / 2) * unitsPerPixel;

    return [minLng, minLat, maxLng, maxLat];
  }, [viewport]);

  return {
    viewport,
    updateViewport,
    flyTo,
    resetViewport,
    zoomIn,
    zoomOut,
    getBbox,
  };
}

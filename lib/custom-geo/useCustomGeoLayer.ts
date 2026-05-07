'use client';

/**
 * MAGELIAN — Hook générique de contribution à la capture custom-geo.
 *
 * Un module qui veut apparaître dans la capture appelle ce hook et fournit
 * son `getGeometry()`. Aucune connaissance de MapLibre / radio / météo / IRIS ici.
 */
import { useEffect } from 'react';
import { useCustomGeoCaptureContext } from './CustomGeoCaptureContext';
import type { ContributedGeometry } from '@/types/custom-geo';

export interface UseCustomGeoLayerOptions {
  id: string;
  sourceType: string;
  label: string;
  getGeometry: () => ContributedGeometry | Promise<ContributedGeometry>;
  metadata?: Record<string, unknown>;
  enabled?: boolean;
}

export function useCustomGeoLayer(layer: UseCustomGeoLayerOptions) {
  const { registerLayer, unregisterLayer, updateLayer } = useCustomGeoCaptureContext();

  // Register au mount, unregister au unmount. La liste de deps inclut id uniquement
  // pour ne pas churner le registre si label/metadata/enabled changent.
  useEffect(() => {
    registerLayer({
      id: layer.id,
      sourceType: layer.sourceType,
      label: layer.label,
      getGeometry: layer.getGeometry,
      metadata: layer.metadata,
      enabled: layer.enabled ?? true,
    });
    return () => unregisterLayer(layer.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id]);

  // Update dynamique quand enabled / label / metadata / getGeometry changent
  useEffect(() => {
    updateLayer(layer.id, {
      enabled: layer.enabled ?? true,
      label: layer.label,
      metadata: layer.metadata,
      getGeometry: layer.getGeometry,
      sourceType: layer.sourceType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.enabled, layer.label, layer.metadata, layer.getGeometry, layer.sourceType]);
}

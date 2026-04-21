'use client';

/**
 * GEOMATIK — CustomGeo capture : Context global des layers contributifs
 *
 * Monté dans app/map/layout.tsx. Expose un registre interne stocké dans un useRef
 * (zéro re-render en cascade quand un layer se réenregistre).
 *
 * Principe : chaque module qui veut contribuer appelle useCustomGeoLayer() et
 * ne connaît rien du reste. Le système est 100% générique.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ContributedLayer } from '@/types/custom-geo';

export interface AdminScope {
  scale: 'region' | 'departement' | 'cp' | 'ville';
  codes: string[];
}

interface CustomGeoCaptureContextValue {
  registerLayer: (layer: ContributedLayer) => void;
  unregisterLayer: (id: string) => void;
  updateLayer: (id: string, partial: Partial<ContributedLayer>) => void;
  getAllEnabledLayers: () => ContributedLayer[];
  layerCount: number;
  // Scope territorial actif (deduit du FilterPanel). Lu par les modules
  // spatiaux (Carreaux, TMJA, Voronoi) au moment du getGeometry().
  activeScope: AdminScope | null;
  setActiveScope: (scope: AdminScope | null) => void;
  /** Getter stable (ref-based). A utiliser dans des closures persistantes. */
  getActiveScope: () => AdminScope | null;
}

const CustomGeoCaptureContext = createContext<CustomGeoCaptureContextValue | null>(null);

export function CustomGeoCaptureProvider({ children }: { children: React.ReactNode }) {
  // Registre dans un ref : les mutations ne provoquent pas de re-render par elles-memes.
  // Le compteur externe (useState) redéclenche uniquement le badge du bouton flottant.
  const registryRef = useRef<Map<string, ContributedLayer>>(new Map());
  const [layerCount, setLayerCount] = useState(0);

  // Scope territorial : ref pour acces stable dans closures + state mirror pour UI.
  const scopeRef = useRef<AdminScope | null>(null);
  const [activeScope, setActiveScopeState] = useState<AdminScope | null>(null);

  const recomputeCount = useCallback(() => {
    let n = 0;
    registryRef.current.forEach(l => { if (l.enabled) n += 1; });
    setLayerCount(n);
  }, []);

  const registerLayer = useCallback((layer: ContributedLayer) => {
    registryRef.current.set(layer.id, layer);
    recomputeCount();
  }, [recomputeCount]);

  const unregisterLayer = useCallback((id: string) => {
    registryRef.current.delete(id);
    recomputeCount();
  }, [recomputeCount]);

  const updateLayer = useCallback((id: string, partial: Partial<ContributedLayer>) => {
    const current = registryRef.current.get(id);
    if (!current) return;
    registryRef.current.set(id, { ...current, ...partial });
    if (partial.enabled !== undefined && partial.enabled !== current.enabled) {
      recomputeCount();
    }
  }, [recomputeCount]);

  const getAllEnabledLayers = useCallback((): ContributedLayer[] => {
    const out: ContributedLayer[] = [];
    registryRef.current.forEach(l => { if (l.enabled) out.push(l); });
    return out;
  }, []);

  const setActiveScope = useCallback((scope: AdminScope | null) => {
    scopeRef.current = scope;
    setActiveScopeState(scope);
  }, []);

  const getActiveScope = useCallback((): AdminScope | null => scopeRef.current, []);

  const value = useMemo(() => ({
    registerLayer, unregisterLayer, updateLayer, getAllEnabledLayers, layerCount,
    activeScope, setActiveScope, getActiveScope,
  }), [registerLayer, unregisterLayer, updateLayer, getAllEnabledLayers, layerCount,
      activeScope, setActiveScope, getActiveScope]);

  return (
    <CustomGeoCaptureContext.Provider value={value}>
      {children}
    </CustomGeoCaptureContext.Provider>
  );
}

export function useCustomGeoCaptureContext(): CustomGeoCaptureContextValue {
  const ctx = useContext(CustomGeoCaptureContext);
  if (!ctx) {
    throw new Error('useCustomGeoCaptureContext must be used within a CustomGeoCaptureProvider');
  }
  return ctx;
}

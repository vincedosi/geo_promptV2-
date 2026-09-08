/**
 * @file filter-panel/use-admin-scope-layer.ts — filtre admin -> couche + scope
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Traduit la selection regions /
 * departements en deux choses :
 *   - une couche custom-geo affichee sur la carte (`map-admin-filter`) ;
 *   - le scope actif partage aux autres modules spatiaux (Carreaux, TMJA,
 *     Voronoi), qui scoperont leur capture dessus en priorite.
 *
 * Priorite departement > region : un seul niveau a la fois, le plus precis.
 *
 * Le `useMemo` sur `adminCodes` est indispensable : sans lui, la branche `[]`
 * fabrique un tableau neuf a chaque render, ce qui invalide `getAdminGeom` et
 * fait rejouer en continu l'effet du masque territoire (demontage/remontage
 * des couches MapLibre).
 */
import { useCallback, useEffect, useMemo } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useCustomGeoLayer } from '@/lib/custom-geo/useCustomGeoLayer';
import { useCustomGeoCaptureContext, type AdminScope } from '@/lib/custom-geo/CustomGeoCaptureContext';
import type { ContributedGeometry } from '@/types/custom-geo';

export type AdminScale = 'region' | 'departement' | null;

export interface AdminScopeLayer {
  /** Niveau du filtre actif, ou null si aucun. */
  adminScale: AdminScale;
  /** Codes INSEE du niveau actif (stable par reference). */
  adminCodes: string[];
}

export function useAdminScopeLayer(
  selectedRegions: string[],
  selectedDepts: string[],
): AdminScopeLayer {
  // ── Custom geo capture : branchement filtre admin actif ───────────────────
  // Priorite : depts (plus precis) > regions. 1 seul scale a la fois.
  // Les valeurs dans selectedRegions / selectedDepts sont les VRAIS codes
  // INSEE (ref_regions.code_region / ref_departements.code_dept) — on les
  // envoie tels quels aux RPCs territory-mask / capture.
  const adminScale: 'region' | 'departement' | null =
    selectedDepts.length > 0 ? 'departement' :
    selectedRegions.length > 0 ? 'region' : null;
  // useMemo indispensable : sans lui, la branche `[]` fabrique un tableau neuf
  // à chaque render, ce qui invalide `getAdminGeom` et fait rejouer l'effet du
  // masque territoire (démontage/remontage des couches MapLibre) en continu.
  const adminCodes = useMemo(
    () => (adminScale === 'departement' ? selectedDepts : adminScale === 'region' ? selectedRegions : []),
    [adminScale, selectedDepts, selectedRegions],
  );
  const getAdminGeom = useCallback(async (): Promise<ContributedGeometry> => {
    if (!adminScale || adminCodes.length === 0) return null;
    const res = await adminFetch('/api/custom-geo/source/admin', {
      method: 'POST',
      body: JSON.stringify({ scale: adminScale, codes: adminCodes }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.geometry ?? null) as ContributedGeometry;
  }, [adminScale, adminCodes]);

  useCustomGeoLayer({
    id: 'map-admin-filter',
    sourceType: 'admin_filter',
    label: adminScale === 'departement'
      ? `Departements (${adminCodes.join(', ')})`
      : adminScale === 'region'
      ? `Regions (${adminCodes.length})`
      : 'Filtre territorial',
    enabled: adminScale !== null && adminCodes.length > 0,
    getGeometry: getAdminGeom,
    metadata: { scale: adminScale, codes: adminCodes },
  });

  // Scope global : declare le filtre territorial comme scope actif pour les
  // autres modules spatiaux (Carreaux/TMJA/Voronoi). Si l'user a un filtre
  // dept ou region, leur capture sera prioritairement scopee dessus.
  const { setActiveScope } = useCustomGeoCaptureContext();
  useEffect(() => {
    if (adminScale && adminCodes.length > 0) {
      const scope: AdminScope = { scale: adminScale, codes: adminCodes };
      setActiveScope(scope);
    } else {
      setActiveScope(null);
    }
  }, [adminScale, adminCodes, setActiveScope]);

  return { adminScale, adminCodes };
}

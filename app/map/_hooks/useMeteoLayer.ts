'use client';

/**
 * MAGELIAN — couche Meteo de la carte (choropleth par zones administratives).
 *
 * Regroupe l'etat, les 2 effets et les 3 callbacks meteo qui vivaient dans
 * app/map/page.tsx (refactor du 31/08/2026) : synchronisation de la source
 * GeoJSON `meteo-source`, popup au clic sur une zone, chargement des polygones
 * de zones et application/effacement d'une interrogation Open-Meteo.
 *
 * ⛔ A appeler APRES useMapInit : le hook a besoin de `mapRef` et `mapReady`.
 *
 * Le cache des polygones est volontairement un `useRef` par echelle : les
 * geometries admin ne changent pas et un re-fetch a chaque application de
 * filtre couterait plusieurs Mo pour rien (contrainte Nano).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { echapperHtml as esc } from '@/lib/map/echapper-html';
import { adminFetch } from '@/lib/admin-fetch';
import { useMeteoData } from '@/lib/meteo/use-meteo-data';
import { buildColorExpression as buildMeteoColorExpr } from '@/lib/meteo/palettes';
import { type MeteoParams, type MeteoScale } from '@/lib/meteo/types';

export function useMeteoLayer(
  mapRef: React.RefObject<maplibregl.Map | null>,
  mapReady: boolean,
) {
  // Météo — choroplèthe par zones admin (Open-Meteo, polygones dép./régions)
  const [meteoVisible, setMeteoVisible] = useState(false);
  const [meteoPanelOpen, setMeteoPanelOpen] = useState(false);
  const [meteoZones, setMeteoZones] = useState<GeoJSON.FeatureCollection | null>(null);
  const meteoZonesCacheRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});

  // ── Météo : hook data + sync source GeoJSON → choroplèthe zones admin ─────
  const meteo = useMeteoData();

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource('meteo-source') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const setMeteoLayersVisibility = (visible: boolean) => {
      try {
        map.setLayoutProperty('meteo-fill', 'visibility', visible ? 'visible' : 'none');
        map.setLayoutProperty('meteo-outline', 'visibility', visible ? 'visible' : 'none');
      } catch { /* */ }
    };

    if (meteo.data && meteo.meta && meteoZones) {
      const features: GeoJSON.Feature[] = [];
      for (const f of meteoZones.features) {
        const code = String(f.properties?.code ?? '');
        const v = meteo.data[code];
        if (!v) continue;
        features.push({
          ...f,
          properties: {
            ...f.properties,
            weather_value: v.value,
            label: v.label,
            unit: v.unit,
          },
        });
      }
      src.setData({ type: 'FeatureCollection', features });
      try {
        map.setPaintProperty('meteo-fill', 'fill-color',
          buildMeteoColorExpr(meteo.meta.variable, meteo.meta.stats, 'weather_value') as maplibregl.ExpressionSpecification,
        );
      } catch { /* */ }
      setMeteoLayersVisibility(meteoVisible);
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      setMeteoLayersVisibility(false);
    }
  }, [meteo.data, meteo.meta, meteoZones, meteoVisible, mapReady, mapRef]);

  // Popup au clic sur une zone météo (nom + valeur + label qualitatif)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as { nom?: string; weather_value?: number; unit?: string; label?: string };
      const value = p.weather_value != null ? Number(p.weather_value) : null;
      new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:Inter,sans-serif;font-size:12px;color:var(--text-primary)">` +
          `<div style="font-weight:500;margin-bottom:2px">${esc(p.nom)}</div>` +
          (value != null
            ? `<div style="font-family:'JetBrains Mono',monospace;color:var(--text-secondary)">${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${esc(p.unit)}</div>`
            : '') +
          (p.label ? `<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${esc(p.label)}</div>` : '') +
          `</div>`,
        )
        .addTo(map);
    };
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', 'meteo-fill', onClick);
    map.on('mouseenter', 'meteo-fill', onEnter);
    map.on('mouseleave', 'meteo-fill', onLeave);
    return () => {
      map.off('click', 'meteo-fill', onClick);
      map.off('mouseenter', 'meteo-fill', onEnter);
      map.off('mouseleave', 'meteo-fill', onLeave);
    };
  }, [mapReady, mapRef]);

  // Charge les polygones de zones (cache mémoire par échelle + cache 1j navigateur)
  const ensureMeteoZones = useCallback(async (scale: MeteoScale) => {
    const cached = meteoZonesCacheRef.current[scale];
    if (cached) { setMeteoZones(cached); return; }
    try {
      const res = await adminFetch(`/api/meteo-geo/zones?scale=${scale}`, { cache: 'force-cache' });
      if (!res.ok) return;
      const fc = await res.json() as GeoJSON.FeatureCollection;
      meteoZonesCacheRef.current[scale] = fc;
      setMeteoZones(fc);
    } catch { /* */ }
  }, []);

  const handleMeteoApply = useCallback(async (params: MeteoParams) => {
    // Granularité choisie par l'utilisateur ; fallback heuristique par durée
    // pour les appels sans scale (compatibilité).
    const days = (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / 86400000;
    const scale: MeteoScale = params.scale ?? (days > 30 ? 'region' : 'departement');
    // Mode cp : le viewport restreint les zones interrogées (CP exacts si la
    // vue en contient ≤ 500, sinon échantillonnage spatial côté serveur).
    let bbox: string | undefined;
    if (scale === 'cp') {
      const b = mapRef.current?.getBounds();
      if (b) bbox = `${b.getWest().toFixed(3)},${b.getSouth().toFixed(3)},${b.getEast().toFixed(3)},${b.getNorth().toFixed(3)}`;
    }
    await ensureMeteoZones(scale);
    const ok = await meteo.fetch(scale, { ...params, bbox });
    if (ok) setMeteoVisible(true);
    return ok;
  }, [meteo, ensureMeteoZones, mapRef]);

  const handleMeteoClear = useCallback(() => {
    meteo.clear();
    setMeteoVisible(false);
  }, [meteo]);


  return {
    meteo,
    meteoVisible,
    meteoPanelOpen, setMeteoPanelOpen,
    handleMeteoApply,
    handleMeteoClear,
  };
}

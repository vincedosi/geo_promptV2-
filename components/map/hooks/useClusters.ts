/**
 * Hook for managing Supercluster clustering
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import Supercluster from 'supercluster';
import {
  Panel,
  GeoJSONFeatureCollection,
  MapViewport,
  ClusterFeature,
} from '@/lib/map/types';
import { panelsToGeoJSON, getPanelLat, getPanelLng } from '@/lib/map/utils';
import { CLUSTERING_CONFIG } from '@/lib/map/config';

export function useClusters(panels: Panel[], viewport: MapViewport) {
  const [clusters, setClusters] = useState<ClusterFeature[]>([]);
  const [unclustered, setUnclustered] = useState<ClusterFeature[]>([]);

  // Initialize Supercluster instance
  const index = useMemo(() => {
    return new Supercluster<Panel, { id: string }>({
      radius: CLUSTERING_CONFIG.radius,
      maxZoom: CLUSTERING_CONFIG.maxZoom,
      minPoints: CLUSTERING_CONFIG.minPoints,
    });
  }, []);

  // Update Supercluster with new panels
  useEffect(() => {
    if (panels.length === 0) {
      setClusters([]);
      setUnclustered([]);
      return;
    }

    // Convert panels to GeoJSON for Supercluster
    const geojson = panelsToGeoJSON(panels);

    // Load data into Supercluster
    index.load(
      geojson.features.map((feature, i) => ({
        type: "Feature" as const,
        geometry: feature.geometry,
        properties: {
          id: (feature.id as string) || i.toString(),
          latitude: feature.geometry.coordinates[1],
          longitude: feature.geometry.coordinates[0],
        } as Panel,
      }))
    );

    // Get clusters and unclustered points
    const zoom = Math.floor(viewport.zoom);
    const bbox: [number, number, number, number] = [
      viewport.longitude - 90 / Math.pow(2, zoom),
      viewport.latitude - 45 / Math.pow(2, zoom),
      viewport.longitude + 90 / Math.pow(2, zoom),
      viewport.latitude + 45 / Math.pow(2, zoom),
    ];

    const clustersData = index.getClusters(bbox, zoom);

    // Separate clusters from unclustered points
    const clusterFeatures: ClusterFeature[] = [];
    const unclusteredFeatures: ClusterFeature[] = [];

    clustersData.forEach((feature) => {
      const clusterFeature: ClusterFeature = {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            feature.geometry.coordinates[0],
            feature.geometry.coordinates[1],
          ],
        },
        properties: {
          cluster: feature.properties?.cluster || false,
          cluster_id: feature.properties?.cluster_id,
          point_count: feature.properties?.point_count,
          point_count_abbreviated: feature.properties?.point_count_abbreviated,
        },
        id: feature.id,
      };

      if (feature.properties?.cluster) {
        clusterFeatures.push(clusterFeature);
      } else {
        unclusteredFeatures.push(clusterFeature);
      }
    });

    setClusters(clusterFeatures);
    setUnclustered(unclusteredFeatures);
  }, [panels, viewport.zoom, viewport.latitude, viewport.longitude, index]);

  // Get cluster expansion info
  const getClusterExpansionZoom = useCallback(
    (clusterId: number): number => {
      return Math.min(
        index.getClusterExpansionZoom(clusterId),
        CLUSTERING_CONFIG.maxZoom
      );
    },
    [index]
  );

  // Get children of cluster
  const getClusterChildren = useCallback(
    (clusterId: number): Panel[] => {
      const children = index.getChildren(clusterId);
      return children
        .filter((child) => !child.properties?.cluster)
        .map((child) => {
          // Find the original panel
          const id = child.properties?.id as string;
          return (
            panels.find((p) => p.id === id) || ({
              id,
              latitude: child.geometry.coordinates[1],
              longitude: child.geometry.coordinates[0],
            } as Panel)
          );
        });
    },
    [index, panels]
  );

  // Build GeoJSON for map layers
  const clusterGeoJSON: GeoJSONFeatureCollection = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: clusters,
    }),
    [clusters]
  );

  const unclusteredGeoJSON: GeoJSONFeatureCollection = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: unclustered,
    }),
    [unclustered]
  );

  return {
    clusters,
    unclustered,
    clusterGeoJSON,
    unclusteredGeoJSON,
    getClusterExpansionZoom,
    getClusterChildren,
    clusterCount: clusters.length,
    unclusteredCount: unclustered.length,
    totalCount: clusters.length + unclustered.length,
  };
}

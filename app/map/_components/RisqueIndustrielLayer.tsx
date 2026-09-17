'use client';

/**
 * RisqueIndustrielLayer — couche dédiée des sites à risque industriel (ICPE).
 *
 * Ne rend rien dans le DOM React : elle pilote MapLibre par un effet, comme
 * `CivicIndicatorsLayer` et `DiffusionMapLayer`.
 *
 * ── Pourquoi une couche à part, et pas le chemin POI générique ─────────────
 *
 * `useMapMarkers` colore par CATÉGORIE (`poiStyles[categorie]`) : une seule
 * teinte pour les 99 152 sites. Aucune légende par type de risque ne pouvait
 * s'y afficher — c'est précisément ce que Vincent constatait. Et au-delà de
 * 500 POI il bascule en nappe de densité, donc jamais les points nets qu'on
 * veut ici. Le chemin générique reste intact pour les lycées et les POI
 * importés : aucune régression.
 *
 * ── Trois couches MapLibre, dans cet ordre ────────────────────────────────
 *
 *  1. `risques-zone`   — la ZONE DE DANGER, un vrai polygone métrique calculé
 *                        par PostGIS (`ST_Buffer` sur `geography`). Affichée
 *                        seulement si l'utilisateur a demandé un rayon.
 *  2. `risques-halo`   — le halo autour du point : un cercle flou en pixels,
 *                        qui donne la lisibilité à faible zoom là où la zone
 *                        métrique devient invisible.
 *  3. `risques-point`  — le point net, cerclé de blanc.
 *
 * Les trois portent la MÊME expression de couleur, celle de
 * `lib/carte/palette-risques.ts`, d'après la propriété `type_risque`. C'est la
 * seule façon d'être sûr que le point et son halo ne se contredisent pas.
 *
 * ── Pourquoi la zone métrique ET le halo en pixels ───────────────────────
 *
 * Ils ne font pas le même travail. La zone est la réalité géographique — 500 m
 * sont 500 m, et c'est elle qu'on croisera avec les carreaux pour compter la
 * population. Le halo est une aide de lecture : à l'échelle de la France, un
 * cercle de 500 m fait moins d'un pixel et disparaîtrait. Les confondre
 * donnerait soit une zone illisible, soit un flou qu'on prendrait pour une
 * mesure.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { echapperHtml as esc } from '@/lib/map/echapper-html';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { adminFetch } from '@/lib/admin-fetch';
import { expressionCouleurRisque, couleurDuType, librellesDuType, LIBELLE_TYPE } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';
import type { TypeRisque } from '@/lib/carte/palette-risques';

const SOURCE_POINTS = 'risques-industriels-src';
const SOURCE_ZONES = 'risques-industriels-zones-src';
const ID_ZONE = 'risques-zone';
const ID_ZONE_CONTOUR = 'risques-zone-contour';
const ID_HALO = 'risques-halo';
const ID_POINT = 'risques-point';

export interface FiltresRisque {
  /** Niveaux réglementaires. Défaut côté route : les deux niveaux Seveso. */
  gravites: string[];
  /**
   * Types de risque retenus (`toxique`, `inflammable`…). Vide = tous.
   * La conversion en libellés de nature — ce que la route attend — se fait
   * dans la couche, par `librellesDuType` : la MÊME fonction que la légende,
   * pour qu'un point filtré « toxique » soit bien celui peint en toxique.
   */
  typesRisque: string[];
  inclureInactifs: boolean;
  /** Rayon de la zone de danger, en mètres. 0 = pas de zone. */
  rayonM: number;
  /** Afficher le halo de lecture autour du point. */
  afficherHalo: boolean;
}

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  actif: boolean;
  filtres: FiltresRisque;
  /** Remonte le compte au panneau : « 1 259 sites affichés sur 1 327 ». */
  onCompte?: (rendus: number, total: number) => void;
}

const LIBELLE_GRAVITE: Record<string, string> = {
  seveso_haut: 'Seveso seuil haut',
  seveso_bas: 'Seveso seuil bas',
  ied: 'Directive IED',
  autorisation: 'Autorisation',
  enregistrement: 'Enregistrement',
  autre: 'Régime déclaratif ou non précisé',
};

/** Une ligne de la popup, omise si la valeur est absente — jamais « null ». */
function ligne(intitule: string, valeur: unknown): string {
  const v = valeur === null || valeur === undefined ? '' : String(valeur).trim();
  if (!v) return '';
  return (
    `<div style="display:flex;gap:8px;margin-top:3px">` +
    `<span style="color:var(--text-tertiary);flex:0 0 96px">${esc(intitule)}</span>` +
    `<span style="color:var(--text-secondary)">${esc(v)}</span></div>`
  );
}

export function RisqueIndustrielLayer({ mapRef, actif, filtres, onCompte }: Props) {
  // Le thème vient du provider, comme dans `DiffusionMapLayer` : MapLibre ne
  // résout pas `var()` dans `paint`, il faut donc savoir quel palier servir.
  const { theme } = useTheme();
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Nettoyage : les couches partent dans l'ordre inverse de leur ajout.
  const nettoyer = () => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of [ID_POINT, ID_HALO, ID_ZONE_CONTOUR, ID_ZONE]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const src of [SOURCE_POINTS, SOURCE_ZONES]) {
      if (map.getSource(src)) map.removeSource(src);
    }
    popupRef.current?.remove();
    popupRef.current = null;
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!actif) {
      nettoyer();
      return;
    }

    let annule = false;

    const charger = async () => {
      const m = mapRef.current;
      if (!m) return;

      // La bbox de la VUE, jamais la France entière : règle I/O du projet.
      const b = m.getBounds();
      const params = new URLSearchParams({
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(','),
        gravites: filtres.gravites.join(','),
        inclure_inactifs: filtres.inclureInactifs ? '1' : '0',
      });
      const natures = filtres.typesRisque.flatMap((t) =>
        librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED),
      );
      // « Risque non précisé » n'a pas de libellé de famille : c'est l'absence
      // de rubrique exploitable. Il se demande donc par son propre libellé.
      if (filtres.typesRisque.includes('non_precise')) natures.push(NATURE_NON_PRECISEE);
      if (natures.length > 0) params.set('natures', natures.join(','));
      if (filtres.rayonM > 0) params.set('rayon_m', String(filtres.rayonM));

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let charge: {
        features: Array<{
          type: 'Feature';
          geometry: { type: 'Point'; coordinates: [number, number] };
          properties: Record<string, unknown>;
        }>;
        n_total?: number;
        n_rendus?: number;
      };
      try {
        // `adminFetch` et non `fetch` : la route est protegee par
        // `requireAuth`, qui ne lit QUE l'en-tete Authorization. Un `fetch`
        // navigateur n'envoie que le cookie et se fait refuser en 401 —
        // constate, pas suppose. Meme choix que `CivicIndicatorsLayer`.
        const res = await adminFetch(`/api/map/risques-industriels?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        charge = await res.json();
      } catch {
        return; // requête annulée par un déplacement de carte : sans conséquence
      }
      if (annule) return;

      const m2 = mapRef.current;
      if (!m2) return;

      // Les propriétés jsonb voyagent mal dans les `feature-state` MapLibre :
      // on aplatit ce dont les couches ont besoin, et on garde le reste en
      // chaîne pour la popup.
      const points = {
        type: 'FeatureCollection' as const,
        features: charge.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            natures_json: JSON.stringify(f.properties.natures_risque ?? []),
            rubriques_json: JSON.stringify(f.properties.rubriques ?? []),
          },
        })),
      };

      // Les zones sont un jeu SÉPARÉ : une source de polygones, pour que le
      // point reste un point (un `circle` ne se dessine pas sur un polygone).
      const zones = {
        type: 'FeatureCollection' as const,
        features: charge.features
          .filter((f) => f.properties.zone)
          .map((f) => ({
            type: 'Feature' as const,
            geometry: f.properties.zone as GeoJSON.Geometry,
            properties: { type_risque: f.properties.type_risque, id: f.properties.id },
          })),
      };

      const couleur = expressionCouleurRisque(theme);

      // ── Source + couches, créées une fois puis mises à jour ──────────────
      const srcZones = m2.getSource(SOURCE_ZONES) as maplibregl.GeoJSONSource | undefined;
      if (srcZones) srcZones.setData(zones as GeoJSON.FeatureCollection);
      else m2.addSource(SOURCE_ZONES, { type: 'geojson', data: zones as GeoJSON.FeatureCollection });

      const srcPoints = m2.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined;
      if (srcPoints) srcPoints.setData(points as GeoJSON.FeatureCollection);
      else m2.addSource(SOURCE_POINTS, { type: 'geojson', data: points as GeoJSON.FeatureCollection });

      if (!m2.getLayer(ID_ZONE)) {
        m2.addLayer({
          id: ID_ZONE,
          type: 'fill',
          source: SOURCE_ZONES,
          paint: {
            'fill-color': couleur as never,
            // Volontairement basse : la zone doit se superposer sans masquer le
            // fond de carte ni les zones voisines qui se recouvrent.
            'fill-opacity': 0.18,
          },
        });
        m2.addLayer({
          id: ID_ZONE_CONTOUR,
          type: 'line',
          source: SOURCE_ZONES,
          paint: { 'line-color': couleur as never, 'line-width': 1, 'line-opacity': 0.5 },
        });
      }

      if (!m2.getLayer(ID_HALO)) {
        m2.addLayer({
          id: ID_HALO,
          type: 'circle',
          source: SOURCE_POINTS,
          paint: {
            'circle-color': couleur as never,
            // Rayon en PIXELS, croissant avec le zoom : c'est une aide de
            // lecture, pas une mesure. La mesure, c'est la couche `zone`.
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 8, 14, 12, 26] as never,
            'circle-blur': 1,
            'circle-opacity': 0.35,
          },
        });
      }

      if (!m2.getLayer(ID_POINT)) {
        m2.addLayer({
          id: ID_POINT,
          type: 'circle',
          source: SOURCE_POINTS,
          paint: {
            'circle-color': couleur as never,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 5, 12, 7] as never,
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.9)',
          },
        });

        // ── Popup : TOUT ce dont on dispose sur le site ──────────────────
        m2.on('click', ID_POINT, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const type = String(p.type_risque ?? 'non_precise') as TypeRisque;

          let natures: string[] = [];
          let rubriques: Array<Record<string, unknown>> = [];
          try {
            natures = JSON.parse(String(p.natures_json ?? '[]'));
            rubriques = JSON.parse(String(p.rubriques_json ?? '[]'));
          } catch { /* charge utile inattendue : on affiche le reste */ }

          const coordonnees = `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}`;
          const rub = rubriques
            .slice(0, 6)
            .map((r) => {
              const q = r.quantite ? ` — ${esc(String(r.quantite))} ${esc(String(r.unite ?? ''))}` : '';
              return `<li style="margin-top:2px">${esc(String(r.numero ?? ''))} ${esc(String(r.nature ?? ''))}${q}</li>`;
            })
            .join('');

          const html =
            `<div style="font-family:Inter,system-ui,sans-serif;font-size:11px;max-width:320px;padding:8px 10px">` +
            `<div style="font-size:12px;font-weight:500;color:var(--text-primary)">${esc(String(p.nom ?? 'Site sans nom'))}</div>` +
            `<div style="display:flex;align-items:center;gap:6px;margin:6px 0">` +
            `<span style="width:8px;height:8px;border-radius:50%;background:${esc(couleurDuType(type, theme))};flex:0 0 auto"></span>` +
            `<span style="color:var(--text-secondary)">${esc(LIBELLE_TYPE[type])}</span></div>` +
            ligne('Niveau', LIBELLE_GRAVITE[String(p.gravite ?? '')] ?? p.gravite) +
            ligne('Adresse', p.adresse) +
            ligne('Commune', [p.code_postal, p.ville].filter(Boolean).join(' ')) +
            ligne('Département', p.departement) +
            ligne('Coordonnées', coordonnees) +
            ligne('Risque principal', p.libelle_nature) +
            (natures.length > 1 ? ligne('Autres risques', natures.slice(1).join(', ')) : '') +
            ligne('Statut Seveso', p.statut_seveso) +
            ligne('Régime', p.regime) +
            ligne('Directive IED', p.ied ? 'oui' : '') +
            ligne('Priorité nationale', p.priorite_nationale ? 'oui' : '') +
            ligne('Activité', p.etat_activite) +
            ligne('DREAL', p.dreal) +
            ligne('SIRET', p.siret) +
            ligne('Code NAF', p.code_naf) +
            ligne('Code AIOT', p.code_aiot) +
            ligne('Dernière inspection', p.derniere_inspection) +
            ligne('Inspections', p.nb_inspections ? `${p.nb_inspections} au total` : '') +
            ligne('Zone affichée', p.rayon_m ? `rayon ${p.rayon_m} m (indicatif)` : '') +
            ligne('Donnée du', p.date_maj_source) +
            (rub
              ? `<div style="margin-top:6px;color:var(--text-tertiary)">Rubriques ICPE</div>` +
                `<ul style="margin:2px 0 0 14px;padding:0;color:var(--text-secondary)">${rub}</ul>` +
                (rubriques.length > 6
                  ? `<div style="color:var(--text-tertiary);margin-top:2px">+ ${rubriques.length - 6} autres</div>`
                  : '')
              : '') +
            `</div>`;

          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: '340px' })
            .setLngLat(f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : e.lngLat)
            .setHTML(html)
            .addTo(m2);
        });

        m2.on('mouseenter', ID_POINT, () => { m2.getCanvas().style.cursor = 'pointer'; });
        m2.on('mouseleave', ID_POINT, () => { m2.getCanvas().style.cursor = ''; });
      }

      // Visibilité pilotée par les réglages, sans recréer les couches.
      const vis = (id: string, visible: boolean) => {
        if (m2.getLayer(id)) m2.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      };
      vis(ID_ZONE, filtres.rayonM > 0);
      vis(ID_ZONE_CONTOUR, filtres.rayonM > 0);
      vis(ID_HALO, filtres.afficherHalo);

      // Couleurs à jour si le thème a changé depuis la création des couches.
      for (const [id, prop] of [[ID_ZONE, 'fill-color'], [ID_ZONE_CONTOUR, 'line-color'], [ID_HALO, 'circle-color'], [ID_POINT, 'circle-color']] as const) {
        if (m2.getLayer(id)) m2.setPaintProperty(id, prop, couleur as never);
      }

      onCompte?.(charge.n_rendus ?? points.features.length, charge.n_total ?? 0);
    };

    void charger();

    // Recharger au déplacement : la bbox change, donc les sites aussi.
    const surDeplacement = () => { void charger(); };
    map.on('moveend', surDeplacement);

    return () => {
      annule = true;
      abortRef.current?.abort();
      map.off('moveend', surDeplacement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapRef,
    actif,
    theme,
    filtres.gravites.join(','),
    filtres.typesRisque.join(','),
    filtres.inclureInactifs,
    filtres.rayonM,
    filtres.afficherHalo,
  ]);

  return null;
}

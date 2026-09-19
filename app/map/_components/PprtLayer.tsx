'use client';

/**
 * Couche « Périmètre PPRT » — les servitudes d'utilité publique PM3.
 *
 * ── CE N'EST PAS LA ZONE DE DANGER, ET LE DESSIN LE DIT ───────────────────
 *
 * `RisqueIndustrielLayer` dessine, autour de chaque installation classée, un
 * **cercle de rayon choisi par l'utilisateur** : un aplat plein, coloré par le
 * type de risque. C'est notre invention, utile pour raisonner.
 *
 * Cette couche dessine les **664 périmètres réglementaires opposables**
 * importés de la Géoplateforme (sql/177). Elle est donc dessinée autrement, à
 * dessein : trait **plein**, aplat presque transparent, et couleur
 * **achromatique** (`lib/carte/palette-pprt.ts`). Sur cette carte la couleur
 * porte le type de risque ; une frontière juridique n'est pas un type de
 * risque, et lui donner une teinte ferait chercher « de quel risque » elle
 * parle. Le trait porte l'autorité, pas la teinte.
 *
 * Le trait était TIRETÉ jusqu'au 2026-09-18, et le cercle calculé plein —
 * l'inverse de la convention cartographique, qui réserve le discontinu à
 * l'approximatif. La règle unique vit dans `lib/carte/nature-zone.ts` :
 * **plein = réglementaire, tireté = calculé**.
 *
 * ── LE PLANCHER DE ZOOM N'EST PAS UNE OPTIMISATION ────────────────────────
 *
 * Un PPRT fait 0,94 km de large en moyenne, 2 m au minimum. Sous
 * `PPRT_ZOOM_PLANCHER` (8), une zone mesure moins d'un pixel : on n'afficherait
 * pas une donnée imprécise, on afficherait du bruit — pour 886 ko. La couche
 * ne demande donc RIEN sous ce zoom et le fait savoir (`onEtat`), pour que le
 * panneau montre un indice au lieu d'une case cochée qui ne produit rien.
 * C'est le défaut exact qui rendait la couche IRIS muette (voir ARCHITECTURE,
 * « Sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile »).
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { adminFetch } from '@/lib/admin-fetch';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { PPRT_ZOOM_PLANCHER } from '@/lib/version';
import { couleursPprt, LARGEUR_TRAIT_PPRT, LIBELLE_TYPE_ZONE_PPRT } from '@/lib/carte/palette-pprt';
import { formaterNombre } from '@/lib/format/nombre';
import { lignePopup as ligne, titrePopup, cadrePopup } from '@/lib/map/popup';

const SOURCE = 'pprt-perimetres';
const ID_FOND = 'pprt-fond';
const ID_CONTOUR = 'pprt-contour';

export interface EtatCouchePprt {
  /** `true` quand la carte est sous le plancher : rien n'est demandé. */
  sousLePlancher: boolean;
  rendus: number;
  total: number;
}

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  actif: boolean;
  /** Familles de `type_zone` retenues. Vide = toutes. */
  typesZone: string[];
  onEtat?: (etat: EtatCouchePprt) => void;
}

interface CollectionPprt {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJSON.Geometry;
    properties: Record<string, unknown>;
  }>;
  n_total?: number;
  n_rendus?: number;
  tolerance_deg?: number;
}

const VIDE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export function PprtLayer({ mapRef, actif, typesZone, onEtat }: Props) {
  // MapLibre ne résout pas `var()` dans `paint` : il faut savoir quel palier
  // servir. Même raison que dans `RisqueIndustrielLayer`.
  const { theme } = useTheme();
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Les gestionnaires de clic ne sont posés qu'UNE fois par montage : les
  // reposer à chaque chargement empilerait une popup par déplacement de carte.
  const clicPoseRef = useRef(false);
  const onEtatRef = useRef(onEtat);
  onEtatRef.current = onEtat;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const nettoyer = () => {
      const m = mapRef.current;
      if (!m) return;
      for (const id of [ID_CONTOUR, ID_FOND]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      if (m.getSource(SOURCE)) m.removeSource(SOURCE);
      popupRef.current?.remove();
      popupRef.current = null;
      clicPoseRef.current = false;
    };

    if (!actif) {
      nettoyer();
      return;
    }

    let annule = false;
    const couleurs = couleursPprt(theme);

    const charger = async () => {
      const m = mapRef.current;
      if (!m) return;

      // ── Plancher de zoom : on ne demande rien, et on le dit ───────────
      if (m.getZoom() < PPRT_ZOOM_PLANCHER) {
        // La source est vidée plutôt que supprimée : la recréer à chaque
        // franchissement du plancher ferait clignoter la couche.
        const src = m.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
        src?.setData(VIDE);
        onEtatRef.current?.({ sousLePlancher: true, rendus: 0, total: 0 });
        return;
      }

      const b = m.getBounds();
      const params = new URLSearchParams({
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
          .map((n) => n.toFixed(4))
          .join(','),
      });
      if (typesZone.length > 0) params.set('types', typesZone.join(','));

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let charge: CollectionPprt;
      try {
        // `adminFetch` et non `fetch` : la route est protégée par
        // `requireAuth`, qui ne lit QUE l'en-tête Authorization. Un `fetch`
        // navigateur n'envoie que le cookie et se fait refuser en 401 —
        // constaté sur `/api/map/risques-industriels`, pas supposé.
        const res = await adminFetch(`/api/map/pprt?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        charge = await res.json();
      } catch {
        return; // requête annulée par un déplacement : sans conséquence
      }
      if (annule) return;

      const m2 = mapRef.current;
      if (!m2) return;

      const collection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: charge.features as GeoJSON.Feature[],
      };

      const src = m2.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(collection);
      else m2.addSource(SOURCE, { type: 'geojson', data: collection });

      if (!m2.getLayer(ID_FOND)) {
        m2.addLayer({
          id: ID_FOND,
          type: 'fill',
          source: SOURCE,
          paint: {
            'fill-color': couleurs.fond,
            // Le fond n'est presque pas visible : il sert surtout de cible de
            // clic. Sans lui, il faudrait viser un trait de 1,5 px.
            'fill-opacity': 1,
          },
        });
      }

      if (!m2.getLayer(ID_CONTOUR)) {
        m2.addLayer({
          id: ID_CONTOUR,
          type: 'line',
          source: SOURCE,
          paint: {
            'line-color': couleurs.contour,
            // Trait PLEIN, et volontairement le plus épais des deux : c'est
            // lui qui affirme une limite opposable. Le cercle calculé de
            // `RisqueIndustrielLayer` est tireté et plus fin
            // (`lib/carte/nature-zone.ts`).
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              8,
              LARGEUR_TRAIT_PPRT * 0.8,
              12,
              LARGEUR_TRAIT_PPRT,
              16,
              LARGEUR_TRAIT_PPRT * 1.4,
            ] as never,
          },
        });
      }

      // ── Popup : tout ce dont on dispose sur la servitude ──────────────
      if (!clicPoseRef.current) {
        clicPoseRef.current = true;

        m2.on('click', ID_FOND, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const type = String(p.type_zone ?? '');
          const km2 = Number(p.superficie_km2);
          const date = p.date_source ? String(p.date_source).slice(0, 10) : '';

          const html = cadrePopup(
            titrePopup(p.nom) +
              `<div style="color:var(--text-tertiary);margin:4px 0 2px">Périmètre PPRT — servitude PM3</div>` +
              ligne('Nature', LIBELLE_TYPE_ZONE_PPRT[type] ?? type) +
              ligne('Département', [p.code_departement, p.nom_departement].filter(Boolean).join(' — ')) +
              // `formaterNombre` et pas un `toFixed` local : source unique de
              // la mise en forme des nombres (il y en avait quinze avant le
              // 2026-09-11). La RPC arrondit déjà à trois décimales.
              ligne('Superficie', Number.isFinite(km2) ? `${formaterNombre(km2)} km²` : '') +
              ligne('Acte', p.fichier_acte) +
              ligne('Tracé', p.mode_geometrie) +
              ligne('Déposé le', date) +
              ligne('Générateur', p.id_generateur) +
              // La phrase qui empêche la confusion la plus coûteuse de cette
              // carte. Elle n'est PAS conditionnelle.
              `<div style="color:var(--text-tertiary);margin-top:6px;line-height:1.4">` +
              `Périmètre réglementaire opposable, et non le rayon indicatif ` +
              `réglable de la couche « Zones à risque industriel ».</div>`,
          );

          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: '340px' })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(m2);
        });

        m2.on('mouseenter', ID_FOND, () => {
          m2.getCanvas().style.cursor = 'pointer';
        });
        m2.on('mouseleave', ID_FOND, () => {
          m2.getCanvas().style.cursor = '';
        });
      }

      // Couleurs à jour si le thème a changé depuis la création des couches.
      if (m2.getLayer(ID_FOND)) m2.setPaintProperty(ID_FOND, 'fill-color', couleurs.fond);
      if (m2.getLayer(ID_CONTOUR)) m2.setPaintProperty(ID_CONTOUR, 'line-color', couleurs.contour);

      onEtatRef.current?.({
        sousLePlancher: false,
        rendus: charge.n_rendus ?? collection.features.length,
        total: charge.n_total ?? 0,
      });
    };

    void charger();

    // Recharger au déplacement : la bbox change, donc les périmètres aussi —
    // et le franchissement du plancher de zoom se détecte ici.
    const surDeplacement = () => {
      void charger();
    };
    map.on('moveend', surDeplacement);

    return () => {
      annule = true;
      abortRef.current?.abort();
      map.off('moveend', surDeplacement);
      nettoyer();
    };
    // `typesZone` est un tableau : le joindre évite de relancer l'effet à
    // chaque rendu sur une référence neuve au contenu identique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, actif, theme, typesZone.join(',')]);

  return null;
}

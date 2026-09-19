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
 *  1. `risques-zone`   — la ZONE CALCULÉE, un vrai polygone métrique produit
 *                        par PostGIS (`ST_Buffer` sur `geography`). Affichée
 *                        seulement si l'utilisateur a demandé un rayon. Son
 *                        contour est TIRETÉ : elle n'a aucune valeur
 *                        réglementaire, contrairement au périmètre PPRT de
 *                        `PprtLayer`, dessiné en trait plein. La convention
 *                        est écrite une seule fois, dans
 *                        `lib/carte/nature-zone.ts`.
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
import { lignePopup as ligne } from '@/lib/map/popup';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { adminFetch } from '@/lib/admin-fetch';
import { expressionCouleurRisque, couleurDuType, librellesDuType, LIBELLE_TYPE, CONTOUR_POINT } from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED, NATURE_NON_PRECISEE } from '@/lib/import/georisques/familles';
import { descriptionStatut, TIRETE_ZONE_CALCULEE, LARGEUR_TRAIT_ZONE } from '@/lib/carte/nature-zone';
import { formaterNombre } from '@/lib/format/nombre';
import type { TypeRisque } from '@/lib/carte/palette-risques';
import { libelleGravite } from '@/lib/risques/gravites';

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
  onCompte?: (rendus: number, total: number, avecPprt: number) => void;
}

// `LIBELLE_GRAVITE` vient de `lib/risques/gravites.ts` : il etait recopie ici,
// dans le panneau Calques et dans l'overlay, et l'overlay divergeait (R-26).

/** Une ligne de la popup, omise si la valeur est absente — jamais « null ». */

/**
 * Va chercher la population exposée et remplit le bloc réservé dans la popup.
 *
 * ── POURQUOI APRÈS L'OUVERTURE, ET PAS AVANT ──────────────────────────────
 *
 * Le calcul croise la zone du site avec `carreaux_filosofi` (2,3 M carreaux de
 * 200 m) et prend environ 300 ms. Le faire avant d'ouvrir la popup ferait
 * paraître la carte figée à chaque clic. On ouvre immédiatement avec un
 * « calcul… », on remplit quand la réponse arrive.
 *
 * ── CE QUI NE DOIT JAMAIS SE PERDRE EN ROUTE ─────────────────────────────
 *
 * `indicatif`. Le même nombre d'habitants ne vaut pas la même chose selon que
 * la zone est la servitude PPRT publiée par l'État, ou un rayon que nous avons
 * choisi. Un chiffre repris dans une recommandation client doit porter cette
 * différence, d'où le bandeau explicite en mode buffer.
 *
 * Si le bloc a disparu (popup fermée, ou remplacée par un autre clic), on
 * abandonne silencieusement : `idBloc` est unique par popup, donc une réponse
 * en retard ne peut pas écrire dans la popup suivante.
 */
async function remplirExposition(siteId: string, idBloc: string): Promise<void> {
  const cible = () => document.getElementById(idBloc);
  if (!siteId || !cible()) return;

  let charge: {
    mode?: 'pprt' | 'buffer';
    indicatif?: boolean;
    paliers?: Array<{ palier: string; libelle: string; pop_exposee: number; pop_couronne: number }>;
    error?: string;
  };
  try {
    const res = await adminFetch(`/api/risques/${encodeURIComponent(siteId)}/exposition`);
    charge = await res.json();
    if (!res.ok) {
      const el = cible();
      if (el) el.textContent = charge?.error ?? 'Population exposée indisponible.';
      return;
    }
  } catch {
    const el = cible();
    if (el) el.textContent = 'Population exposée indisponible.';
    return;
  }

  const el = cible();
  if (!el) return;

  const paliers = charge.paliers ?? [];
  if (paliers.length === 0) {
    el.textContent = 'Population exposée non calculable.';
    return;
  }

  const indicatif = charge.indicatif !== false;
  const lignes = paliers
    .map((pa) => {
      // En mode buffer, la couronne dit ce que CE palier ajoute au précédent :
      // sans elle, trois cumuls croissants se lisent comme trois populations
      // distinctes qu'on serait tenté d'additionner.
      const sup =
        charge.mode === 'buffer' && pa.pop_couronne !== pa.pop_exposee
          ? `<span style="color:var(--text-tertiary)"> (+${esc(formaterNombre(pa.pop_couronne))})</span>`
          : '';
      return (
        `<div style="display:flex;justify-content:space-between;gap:10px">` +
        `<span style="color:var(--text-secondary)">${esc(pa.libelle)}</span>` +
        `<span style="font-family:'JetBrains Mono',monospace;color:var(--text-primary)">` +
        `${esc(formaterNombre(pa.pop_exposee))}${sup}</span></div>`
      );
    })
    .join('');

  el.innerHTML =
    `<div style="color:var(--text-primary);font-weight:500;margin-bottom:4px">Population exposée</div>` +
    lignes +
    `<div style="color:var(--text-tertiary);margin-top:4px;line-height:1.4">` +
    (indicatif
      ? 'Estimée sur des rayons choisis dans le panneau — aucune valeur réglementaire.'
      : 'Estimée sur le périmètre PPRT publié par l’État.') +
    ' Répartition au prorata de surface des carreaux INSEE de 200 m.' +
    `</div>`;
}

export function RisqueIndustrielLayer({ mapRef, actif, filtres, onCompte }: Props) {
  // Le thème vient du provider, comme dans `DiffusionMapLayer` : MapLibre ne
  // résout pas `var()` dans `paint`, il faut donc savoir quel palier servir.
  const { theme } = useTheme();
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Les gestionnaires de clic ne sont posés qu'UNE fois par montage.
   *
   * Ils l'étaient auparavant dans la branche de CRÉATION de la couche, sous
   * `if (!m2.getLayer(ID_POINT))`. Or `nettoyer()` supprime la couche quand
   * `actif` repasse à `false`, sans jamais faire `off()` : au ré-affichage la
   * branche était de nouveau vraie et un écouteur de plus s'ajoutait. Après N
   * décochages/recochages, **un clic déclenchait N appels** à
   * `/api/risques/[siteId]/exposition`.
   *
   * `PprtLayer` résolvait déjà exactement ce cas avec ce même drapeau, et le
   * documentait — la correction n'existait que d'un côté (constat R-03 de
   * `docs/AUDIT_ZONE_RISQUE.md`).
   */
  /**
   * Les données riches de chaque site, gardées À CÔTÉ de la source MapLibre.
   *
   * MapLibre aplatit les propriétés imbriquées : `natures_risque` et
   * `rubriques` ne survivent pas à un `feature-state`. La parade était de les
   * SÉRIALISER dans chaque feature — donc deux `JSON.stringify` par site, à
   * chaque `moveend`, jusqu'à 5 000 sites : 10 000 sérialisations sur le thread
   * principal par panoramique, pour des données ensuite RÉ-ANALYSÉES au clic
   * (constat R-22 de `docs/AUDIT_ZONE_RISQUE.md`).
   *
   * Une table indexée par identifiant coûte une écriture par site au
   * chargement, et une lecture pour le seul site cliqué. Le contenu de la
   * popup est identique.
   */
  const donneesRef = useRef(new Map<string, { natures: string[]; rubriques: Array<Record<string, unknown>> }>());
  const clicPoseRef = useRef(false);
  /** Les références gardées pour pouvoir retirer les écouteurs au démontage. */
  const ecouteursRef = useRef<Array<[string, (e: never) => void]>>([]);
  /**
   * `onCompte` passe par une ref : capturé en closure, il restait figé à la
   * valeur du dernier passage de l'effet, dont les dépendances sont
   * `eslint-disable`d. Même patron que `onEtatRef` dans `PprtLayer` (R-04).
   */
  const onCompteRef = useRef(onCompte);
  onCompteRef.current = onCompte;

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
        n_avec_pprt?: number;
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

      // Les propriétés jsonb voyagent mal dans les `feature-state` MapLibre.
      // Plutôt que de les sérialiser dans chaque feature, on les range à côté,
      // indexées par identifiant — voir `donneesRef`.
      donneesRef.current = new Map(
        charge.features.map((f) => [
          String(f.properties.id),
          {
            natures: (f.properties.natures_risque as string[] | undefined) ?? [],
            rubriques: (f.properties.rubriques as Array<Record<string, unknown>> | undefined) ?? [],
          },
        ]),
      );
      const points = { type: 'FeatureCollection' as const, features: charge.features };

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
          paint: {
            'line-color': couleur as never,
            // Trait TIRETÉ et fin : cette zone est CALCULÉE par nous, elle
            // n'a aucune valeur réglementaire. Le périmètre PPRT de
            // `PprtLayer` est plein et plus épais. Convention unique :
            // `lib/carte/nature-zone.ts`.
            'line-width': LARGEUR_TRAIT_ZONE,
            'line-opacity': 0.7,
            'line-dasharray': [...TIRETE_ZONE_CALCULEE] as never,
          },
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
            'circle-stroke-color': CONTOUR_POINT[theme],
          },
        });
      }

      // ── Popup : TOUT ce dont on dispose sur le site ────────────────────
      //
      // HORS de la branche de création de couche, et gardé par `clicPoseRef` :
      // voir le commentaire de ce drapeau plus haut. Une seule pose par
      // montage, quel que soit le nombre de cycles décocher/recocher.
      if (!clicPoseRef.current) {
        clicPoseRef.current = true;

        const surClic = (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const type = String(p.type_risque ?? 'non_precise') as TypeRisque;

          // Lues dans la table du chargement, jamais ré-analysées : la feature
          // MapLibre ne porte plus de chaîne JSON. Un site absent de la table
          // (chargement en cours) affiche simplement le reste de la popup.
          const riches = donneesRef.current.get(String(p.id ?? ''));
          const natures: string[] = riches?.natures ?? [];
          const rubriques: Array<Record<string, unknown>> = riches?.rubriques ?? [];

          const coordonnees = `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}`;
          // Calculé en base (sql/179) et seulement mis en mots ici : la
          // couche, la popup et la légende doivent lire la même règle.
          const statut = descriptionStatut(p.statut_zone as string | null | undefined);
          // Identifiant unique : deux popups successives ne doivent pas se
          // remplir l'une l'autre si la première réponse arrive en retard.
          const idExpo = `expo-${Math.random().toString(36).slice(2)}`;
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
            ligne('Niveau', libelleGravite(String(p.gravite ?? ''))) +
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
            // ── La réponse à « calculée ou réelle ? », en tête de bloc ─────
            // Toujours affichée, jamais conditionnelle : un site sans
            // périmètre doit le DIRE, sinon son absence se lit comme un oubli
            // de notre import. `statut` vient de la base (sql/179), il n'est
            // pas redéduit ici.
            `<div style="margin-top:8px;padding-top:6px;border-top:0.5px solid var(--border-subtle)">` +
            `<div style="display:flex;align-items:center;gap:6px">` +
            `<span style="width:14px;height:0;flex:0 0 auto;border-top:1.5px ${statut.reglementaire ? 'solid' : 'dashed'} var(--text-secondary)"></span>` +
            `<span style="color:var(--text-primary);font-weight:500">${esc(statut.libelle)}</span>` +
            (p.pprt_km2 ? `<span style="color:var(--text-secondary)">— ${esc(formaterNombre(Number(p.pprt_km2)))} km²</span>` : '') +
            `</div>` +
            (p.pprt_nom ? ligne('Plan', p.pprt_nom) : '') +
            // La distance n'est pas décorative : le rattachement tolère 500 m
            // pour rattraper le géocodage AIOT, donc « dans le périmètre » et
            // « à 300 m du périmètre » ne sont pas la même chose et l'écran
            // ne doit pas les confondre.
            (Number(p.pprt_distance_m) > 0
              ? ligne('Distance au périmètre', `${formaterNombre(Number(p.pprt_distance_m))} m`)
              : '') +
            `<div style="color:var(--text-tertiary);margin-top:4px;line-height:1.4">${esc(statut.explication)}</div>` +
            `</div>` +
            ligne('Zone affichée', p.rayon_m ? `rayon ${p.rayon_m} m — calculé, indicatif` : '') +
            ligne('Donnée du', p.date_maj_source) +
            (rub
              ? `<div style="margin-top:6px;color:var(--text-tertiary)">Rubriques ICPE</div>` +
                `<ul style="margin:2px 0 0 14px;padding:0;color:var(--text-secondary)">${rub}</ul>` +
                (rubriques.length > 6
                  ? `<div style="color:var(--text-tertiary);margin-top:2px">+ ${rubriques.length - 6} autres</div>`
                  : '')
              : '') +
            // Emplacement de la population exposée. Le calcul croise les
            // carreaux Filosofi 200 m et prend ~300 ms : le faire AVANT
            // d'ouvrir la popup ferait paraître la carte figée au clic.
            // On ouvre tout de suite, on remplit ensuite.
            `<div id="${idExpo}" style="margin-top:8px;padding-top:6px;border-top:0.5px solid var(--border-subtle);color:var(--text-tertiary)">Population exposée — calcul…</div>` +
            `</div>`;

          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: '340px' })
            .setLngLat(f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : e.lngLat)
            .setHTML(html)
            .addTo(m2);

          void remplirExposition(String(p.id ?? ''), idExpo);
        };

        const surEntree = () => { m2.getCanvas().style.cursor = 'pointer'; };
        const surSortie = () => { m2.getCanvas().style.cursor = ''; };

        m2.on('click', ID_POINT, surClic);
        m2.on('mouseenter', ID_POINT, surEntree);
        m2.on('mouseleave', ID_POINT, surSortie);

        // Gardés pour pouvoir les retirer au démontage : `removeLayer` ne
        // retire PAS les écouteurs délégués, c'est toute l'origine du défaut.
        ecouteursRef.current = [
          ['click', surClic],
          ['mouseenter', surEntree],
          ['mouseleave', surSortie],
        ];
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
      // Le cerne aussi : il s'inverse entre thèmes depuis R-12, et l'oublier
      // ici le laisserait blanc sur fond clair après une bascule.
      if (m2.getLayer(ID_POINT)) {
        m2.setPaintProperty(ID_POINT, 'circle-stroke-color', CONTOUR_POINT[theme] as never);
      }

      onCompteRef.current?.(
        charge.n_rendus ?? points.features.length,
        charge.n_total ?? 0,
        charge.n_avec_pprt ?? 0,
      );
    };

    void charger();

    // Recharger au déplacement : la bbox change, donc les sites aussi.
    const surDeplacement = () => { void charger(); };
    map.on('moveend', surDeplacement);

    return () => {
      annule = true;
      abortRef.current?.abort();
      map.off('moveend', surDeplacement);

      // `nettoyer()` manquait ici — sources et couches MapLibre survivaient au
      // démontage, alors que `PprtLayer` le faisait déjà (R-04). Les écouteurs
      // délégués partent avec, sans quoi ils resteraient armés sur une couche
      // qui n'existe plus.
      for (const [type, fn] of ecouteursRef.current) {
        map.off(type as 'click', ID_POINT, fn as never);
      }
      ecouteursRef.current = [];
      clicPoseRef.current = false;
      nettoyer();
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

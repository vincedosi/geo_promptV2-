'use client';

/**
 * ZonesRisqueLayer — les zones de risque d'un profil de rayons, en MVT.
 *
 * Ne rend rien dans le DOM React : elle pilote MapLibre par un effet, comme
 * `PprtLayer` et `RisqueIndustrielLayer`.
 *
 * ── CE QU'ELLE MONTRE, ET CE QU'ELLE NE MONTRE PAS ───────────────────────
 *
 * La géométrie exacte de ce que le tableau des bandes compte. Les classes sont
 * EXCLUSIVES par construction (sql/205 les découpe par `ST_Difference`) : ce
 * qu'on voit à un endroit est la couleur d'UNE seule bande, jamais la somme de
 * plusieurs. Sans cette exclusivité, un centre couvert par quatre anneaux
 * empilerait 0,45 + 0,28 + 0,16 + 0,08 et saturerait en aplat opaque.
 *
 * ⚠ La zone est CONTINUE, le comptage porte sur des carreaux de 200 m
 * rattachés par leur CENTRE. La limite dessinée est exactement le lieu où le
 * centre bascule — c'est donc cohérent — mais il ne faut pas lire la surface
 * colorée comme une surface d'habitants proportionnelle.
 *
 * ── POURQUOI UNE SEULE COUCHE DE REMPLISSAGE ─────────────────────────────
 *
 * La teinte vient d'une expression `match` sur `niveau`, l'opacité d'un `case`
 * sur `bande`. Peindre chaque classe dans sa propre couche MapLibre en
 * demanderait jusqu'à huit, à détruire et recréer à chaque anneau déplacé —
 * et MapLibre recharge alors ses tuiles, ce qui annulerait tout l'intérêt du
 * cache.
 *
 * ── LA CONVENTION DE TRAIT ───────────────────────────────────────────────
 *
 * Tireté = zone CALCULÉE par nous. Plein = servitude publiée par l'État. La
 * convention vit une seule fois, dans `lib/carte/nature-zone.ts`, et elle est
 * la même sur la couche des sites, sur celle des périmètres PPRT et dans le
 * tableau des bandes. Le même signe doit vouloir dire la même chose partout.
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { ZONES_RISQUE_ZOOM_PLANCHER } from '@/lib/version';
import {
  expressionCouleurNiveau, expressionOpaciteBande,
} from '@/lib/carte/palette-zones-risque';
import { TIRETE_ZONE_CALCULEE, LARGEUR_TRAIT_ZONE } from '@/lib/carte/nature-zone';
import { codeProfil } from '@/lib/risques/code-profil';
import type { ProfilRayons } from '@/lib/risques/profil';

/**
 * Nom de l'événement d'activation — partagé, jamais recopié en littéral.
 *
 * ⚠ Un `CustomEvent` et non une prop, parce que l'overlay et la carte sont dans
 * DEUX branches d'arbre React qu'aucune prop ne peut traverser. Même chemin que
 * `SCORE_MAP_EVENT` ; la Diffusion, elle, passe par un contexte global parce
 * qu'elle vit du même côté.
 */
export const ZONES_RISQUE_EVENT = 'magelian:zones-risque';

export interface ZonesRisqueEventDetail {
  /** Le profil à afficher, ou `null` pour éteindre la couche. */
  profil: ProfilRayons | null;
  /**
   * Bbox `[ouest, sud, est, nord]` sur laquelle recadrer la carte.
   *
   * Sert les zooms de référence de l'atelier — vallée de la chimie, Le Havre,
   * Fos-sur-Mer — où les zones se SUPERPOSENT, ce qu'une vue France entière
   * ne montre jamais : à cette échelle une zone de 2 km fait moins d'un pixel.
   *
   * ⚠ Le recadrage vit ICI et non chez l'appelant : c'est cette couche qui
   * tient `mapRef`. Un bouton qui allumerait la couche sans bouger la caméra
   * laisserait l'utilisateur devant une France vide, ce qui se lit comme un
   * bouton cassé.
   */
  recadrer?: [number, number, number, number];
}

const SOURCE = 'zones-risque';
const ID_FOND = 'zones-risque-fond';
const ID_CONTOUR = 'zones-risque-contour';
const ID_PPRT = 'zones-risque-contour-pprt';

interface Props {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Signale que la carte est sous le plancher : rien n'est demandé. */
  onSousLePlancher?: (sous: boolean) => void;
  /** Remonte le profil affiché, pour que la page gère l'exclusivité des dégradés. */
  onProfil?: (p: ProfilRayons | null) => void;
}

export function ZonesRisqueLayer({ mapRef, onSousLePlancher, onProfil }: Props) {
  /*
   * Le profil vient de l'ÉVÉNEMENT, pas d'une prop : l'overlay qui le règle vit
   * dans une autre branche de l'arbre React. La couche est donc son propre
   * point d'entrée, comme `ScoreMapLayer`.
   */
  const [profil, setProfil] = useState<ProfilRayons | null>(null);
  const onProfilRef = useRef(onProfil);
  onProfilRef.current = onProfil;

  useEffect(() => {
    const surEvenement = (e: Event) => {
      const detail = (e as CustomEvent<ZonesRisqueEventDetail>).detail;
      setProfil(detail?.profil ?? null);
      onProfilRef.current?.(detail?.profil ?? null);
      const bbox = detail?.recadrer;
      if (bbox && mapRef.current) {
        // `padding` : sans marge, les zones du bord se collent au cadre et on
        // ne voit plus qu'elles s'arrêtent là.
        mapRef.current.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 48, duration: 900 },
        );
      }
    };
    window.addEventListener(ZONES_RISQUE_EVENT, surEvenement);
    return () => window.removeEventListener(ZONES_RISQUE_EVENT, surEvenement);
    // `mapRef` est une ref : sa référence est stable, la relire à chaque
    // événement donne la carte du moment sans rejouer l'abonnement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actif = profil !== null;
  // MapLibre ne résout pas `var()` dans `paint` : il faut savoir quel palier
  // servir. Même raison que dans `PprtLayer` et `RisqueIndustrielLayer`.
  const { theme } = useTheme();
  const onSousRef = useRef(onSousLePlancher);
  onSousRef.current = onSousLePlancher;

  // Le profil est une valeur d'objet : sa forme canonique est ce qui doit
  // entrer dans les dépendances, sinon l'effet se rejoue à chaque rendu et
  // MapLibre redemande toutes ses tuiles.
  const code = profil ? codeProfil(profil) : '';

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const nettoyer = () => {
      const m = mapRef.current;
      if (!m) return;
      for (const id of [ID_PPRT, ID_CONTOUR, ID_FOND]) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      if (m.getSource(SOURCE)) m.removeSource(SOURCE);
    };

    if (!actif) {
      nettoyer();
      onSousRef.current?.(false);
      return;
    }

    const poser = () => {
      const m = mapRef.current;
      if (!m || !m.isStyleLoaded()) return;

      // La source porte le profil dans son URL. Changer de profil impose donc
      // de la RECRÉER : MapLibre ne permet pas de réécrire l'URL d'une source
      // vectorielle existante, et la garder servirait indéfiniment les tuiles
      // de l'ancien profil — une carte qui contredit sa propre légende.
      nettoyer();

      m.addSource(SOURCE, {
        type: 'vector',
        tiles: [
          `${window.location.origin}/api/tiles/zones-risque/{z}/{x}/{y}`
          + `?profil=${encodeURIComponent(code)}`,
        ],
        minzoom: ZONES_RISQUE_ZOOM_PLANCHER,
        maxzoom: 14,
      });

      m.addLayer({
        id: ID_FOND,
        type: 'fill',
        source: SOURCE,
        'source-layer': 'zones_risque',
        paint: {
          'fill-color': expressionCouleurNiveau(theme) as never,
          'fill-opacity': expressionOpaciteBande() as never,
        },
      });

      // Contour des bandes CALCULÉES : tireté, comme la zone calculée de la
      // couche des sites.
      m.addLayer({
        id: ID_CONTOUR,
        type: 'line',
        source: SOURCE,
        'source-layer': 'zones_risque',
        filter: ['!=', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE,
          'line-dasharray': TIRETE_ZONE_CALCULEE as never,
          'line-opacity': 0.9,
        },
      });

      // Contour des périmètres PUBLIÉS : trait plein et plus épais. Un lecteur
      // doit pouvoir distinguer l'opposable du calculé sans lire la légende.
      m.addLayer({
        id: ID_PPRT,
        type: 'line',
        source: SOURCE,
        'source-layer': 'zones_risque',
        filter: ['==', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE + 0.5,
          'line-opacity': 1,
        },
      });
    };

    if (map.isStyleLoaded()) poser();
    else map.once('load', poser);

    /*
     * ⚠ Sous le minzoom d'une source, MapLibre ne demande AUCUNE tuile et
     * n'émet AUCUNE erreur. C'est ce qui rendait la couche IRIS muette quand
     * son plancher était à z9 et la carte à z5,5 (ARCHITECTURE.md). On le
     * signale donc au panneau, pour qu'il montre un indice plutôt qu'une case
     * cochée qui ne produit rien.
     */
    const surZoom = () => {
      const m = mapRef.current;
      if (m) onSousRef.current?.(m.getZoom() < ZONES_RISQUE_ZOOM_PLANCHER);
    };
    surZoom();
    map.on('zoomend', surZoom);

    return () => {
      map.off('zoomend', surZoom);
      nettoyer();
    };
  }, [mapRef, actif, code, theme]);

  return null;
}

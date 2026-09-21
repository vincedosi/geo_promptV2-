'use client';

/**
 * La carte du module de risque — permanente, une seule instance.
 *
 * ── POURQUOI ELLE EXISTE ──────────────────────────────────────────────────
 *
 * L'onglet Zones était une pile de bandeaux : des rayons candidats, des zooms
 * de référence, un tableau de classes, une bibliothèque. Un atelier de ZONES
 * qui ne montrait aucune zone, et où « adopter 2 km » se décidait sur un
 * chiffre sans jamais voir ce que ces 2 km recouvrent.
 *
 * La carte devient donc le centre de l'écran, et les réglages passent à côté.
 *
 * ── ELLE ÉTAIT `CarteZones`, ET NE L'EST PLUS (2026-09-21) ────────────────
 *
 * Elle ne vivait que dans l'étape ④, alors que la carte EST l'objet du
 * module : on choisit des sites, on règle un rayon, on lit une couverture —
 * les trois se regardent sur une carte, et il fallait atteindre la dernière
 * étape pour en voir une.
 *
 * ⚠ **Une seule instance MapLibre, montée au niveau de l'overlay et JAMAIS
 * démontée entre les étapes** : seules les couches et la caméra changent. La
 * démonter et la remonter à chaque étape coûterait un rechargement complet du
 * fond, de la position et des tuiles — et surtout, on perdrait la vue de
 * l'utilisateur à chaque aller-retour entre ② et ③, qui est le geste le plus
 * fréquent du module.
 *
 * ── DEUX COUCHES, DEUX SOURCES, DEUX RAISONS ──────────────────────────────
 *
 * Les ZONES viennent des tuiles MVT déjà servies par `/api/tiles/zones-risque`
 * (sql/205) : géométries exclusives, découpées par `ST_Difference`, donc ce
 * qu'on voit à un endroit est la couleur d'UNE seule bande. Les peindre depuis
 * un GeoJSON chargé à la volée aurait demandé de refaire ce découpage côté
 * client, et de le refaire à chaque panoramique.
 *
 * Les SITES viennent de `/api/map/risques-industriels`, en GeoJSON sur la bbox
 * visible. Il n'existe pas de tuile pour eux, et il n'en faut pas : on n'en
 * affiche que quelques centaines à la fois, jamais les 99 152.
 *
 * ── LE PLANCHER DE ZOOM N'EST PAS UNE COQUETTERIE ─────────────────────────
 *
 * Sous `ZONES_RISQUE_ZOOM_PLANCHER`, MapLibre ne demande AUCUNE tuile et
 * n'émet aucune erreur — c'est ce qui a rendu la couche IRIS muette pendant
 * des mois. À l'échelle de la France, une zone de 2 km fait d'ailleurs moins
 * d'un pixel. La carte ouvre donc au-dessus du plancher, et le dit quand on
 * passe dessous.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { adminFetch } from '@/lib/admin-fetch';
import {
  ZONES_RISQUE_ZOOM_PLANCHER, ZONES_RISQUE_ZOOM_LISIBLE, ZONES_RISQUE_ZOOM_DETAIL,
} from '@/lib/version';
import {
  expressionCouleurNiveau, expressionOpaciteSelonZoom,
  COULEUR_NIVEAU, COULEUR_NIVEAU_CSS, OPACITE_BANDE,
} from '@/lib/carte/palette-zones-risque';
// ⚠ Réutilisé et non réécrit : 64 segments, projection sphérique, déjà en
// service sur la carte du copilote. Un second cercle « maison » dans le même
// produit, c'est le défaut des quinze `fmtNum` de `lib/format/nombre.ts`.
import { circleGeoJSON } from '@/app/copilote/_lib/constants';
import { usePiste } from '@/components/risques/ContexteChargement';
import { TIRETE_ZONE_CALCULEE, LARGEUR_TRAIT_ZONE } from '@/lib/carte/nature-zone';
import { CONTOUR_POINT } from '@/lib/carte/palette-risques';
import { codeProfil, codeZonesRisque } from '@/lib/risques/code-profil';
import { LIBELLE_NIVEAU, anneauxDuNiveau, NIVEAUX, libelleRayon, type Niveau, type ProfilRayons } from '@/lib/risques/profil';
import { formaterNombre } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';

const SOURCE_ZONES = 'atelier-zones';
const SOURCE_SITES = 'atelier-sites';
const SOURCE_SURVOL = 'atelier-survol';
const SOURCE_APERCU = 'atelier-apercu';
const ID_FOND = 'atelier-zones-fond';
const ID_CONTOUR = 'atelier-zones-contour';
const ID_PPRT = 'atelier-zones-pprt';
const ID_ETIQUETTES = 'atelier-zones-etiquettes';
const ID_SITES = 'atelier-sites-points';

/**
 * Toutes les couches servies par la source des zones.
 *
 * ⚠ Elles doivent être retirées AVANT la source, sinon `removeSource` lève —
 * et l'ancienne source reste, servant les tuiles du profil précédent sous la
 * légende du nouveau. Une couche ajoutée sans être déclarée ici produit
 * exactement ce défaut, en silence côté écran.
 */
const COUCHES_ZONES = [ID_FOND, ID_CONTOUR, ID_PPRT, ID_ETIQUETTES] as const;
const ID_SURVOL = 'atelier-survol-cercles';
const ID_APERCU = 'atelier-apercu-cercles';

/**
 * Le nombre de sites dont on dessine l'aperçu pendant un glissement.
 *
 * 64 segments par cercle, reconstruits à chaque position du curseur : à 800
 * sites cela ferait 51 200 points par image, sur un écran qui porte déjà une
 * carte WebGL. Les sites sont déjà bornés à la bbox visible ; ce plafond
 * n'agit que sur les grappes les plus denses — où la centième couronne
 * n'apprend plus rien de toute façon.
 */
const APERCU_SITES_MAX = 250;

/**
 * Le halo des étiquettes de rayon.
 *
 * ⚠ INVERSÉ entre thèmes, comme `--halo-carte` du DESIGN_SYSTEM : un halo
 * sombre sur fond clair noircit le texte au lieu de le détourer. Littéral et
 * non `var()` — c'est MapLibre qui le lit.
 */
const HALO_ETIQUETTE: Record<'dark' | 'light', string> = {
  dark: 'rgba(0,0,0,0.75)',
  light: 'rgba(255,255,255,0.85)',
};

/** Fond de carte neutre : la donnée doit dominer, pas le décor. */
const FONDS: Record<'dark' | 'light', string> = {
  dark: 'https://tiles.openfreemap.org/styles/positron',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

/**
 * Les trois grappes industrielles denses.
 *
 * Densité mesurée le 2026-09-20, sites Seveso haut / bas dans chaque cadre :
 * Fos 41/14, Le Havre 22/12, vallée de la chimie 17/8. Elles existent parce
 * qu'une vue France entière ne montre JAMAIS l'objet de l'atelier : à cette
 * échelle une zone de 2 km fait moins d'un pixel.
 *
 * NON exportée : les boutons qui s'en servent vivent DANS cette carte. Un
 * export sans consommateur est du code mort que `npm run catalogue` compte,
 * et qui laisse croire qu'un autre écran s'en sert.
 */
const GRAPPES: Array<{ nom: string; bbox: [number, number, number, number] }> = [
  { nom: 'Vallée de la chimie', bbox: [4.75, 45.6, 5.05, 45.75] },
  { nom: 'Estuaire de la Seine', bbox: [0.05, 49.4, 0.55, 49.55] },
  { nom: 'Étang de Berre', bbox: [4.75, 43.35, 5.3, 43.6] },
];

/** Vue d'ouverture : l'Étang de Berre, la grappe la plus dense. */
const VUE_INITIALE = GRAPPES[2].bbox;

interface Props {
  profil: ProfilRayons;
  /**
   * Le rayon en cours de réglage, tant que la réglette n'est pas relâchée.
   *
   * ⚠ APPROXIMATIF, et il faut le savoir : ce sont des DISQUES centrés sur
   * chaque site, pas les zones réelles. Les vraies sont exclusives — sql/205
   * les découpe par `ST_Difference`, le périmètre PPRT prime sur l'anneau du
   * même niveau, et le seuil bas est amputé de l'empreinte du seuil haut.
   * Reproduire ce découpage côté client à chaque position du curseur
   * demanderait un moteur géométrique que le navigateur n'a pas.
   *
   * L'aperçu répond à « jusqu'où ça va », pas à « qui appartient à quoi ». Au
   * relâchement, la vraie géométrie reprend la main.
   */
  apercu?: { niveau: Niveau | null; rayonM: number } | null;
  gravites: string[];
  /**
   * Natures de risque retenues. Vide = toutes.
   *
   * ⚠ Elles pilotent TROIS choses à la fois — les sites affichés, la clé de
   * cache des zones, et donc les tuiles demandées. Les oublier sur l'une des
   * trois donnerait une carte qui se contredit : des anneaux autour de sites
   * qu'elle n'affiche pas, ou l'inverse.
   */
  natures: string[];
}

export function CarteRisque({ profil, apercu, gravites, natures }: Props) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();
  const [zoom, setZoom] = useState(9);
  const [nSites, setNSites] = useState<number | null>(null);
  const [preparation, setPreparation] = useState(false);

  /*
   * ⚠ Le profil dans une `ref`, lu par le gestionnaire de survol.
   *
   * L'effet qui pose ce gestionnaire ne dépend QUE des filtres — le remonter
   * sur le profil le rattacherait à chaque anneau déplacé, et chaque passe
   * laisserait un écouteur de plus. La `ref` donne au survol la valeur du
   * moment sans lier son cycle de vie à celui du profil.
   */
  const profilRef = useRef(profil);
  profilRef.current = profil;

  /*
   * La construction de la géométrie des zones, mesurée à 2 805 ms pour les
   * sept classes du profil par défaut sur la France entière (1 326 ms avant le
   * lissage de sql/223). Elle se déclarait
   * jusqu'ici par une pastille posée SUR la carte, invisible dès qu'on
   * regardait le panneau — c'est-à-dire pendant qu'on réglait.
   */
  usePiste('zones', 'Découpage des zones…', preparation);

  /** Les sites actuellement chargés — la source des cercles d'aperçu. */
  const sitesRef = useRef<GeoJSON.FeatureCollection | null>(null);

  // ⚠ Les formes SÉRIALISÉES, jamais les tableaux : recréés à chaque rendu du
  // parent, ils relanceraient les effets indéfiniment.
  const cleGravites = gravites.join(',');
  const cleNatures = natures.join(',');
  /*
   * La clé de cache des ZONES porte le profil ET les natures, par la même
   * fonction que les deux routes serveur (préparation et tuiles). Sans les
   * natures, un filtre changeait le tableau et laissait la carte sur les
   * anneaux de tous les sites — la forme exacte du défaut que ce chantier
   * corrige, en plus visible.
   */
  const codeSeul = useMemo(() => codeProfil(profil), [profil]);
  const code = useMemo(
    () => codeZonesRisque(codeSeul, cleNatures ? cleNatures.split(',') : []),
    [codeSeul, cleNatures],
  );

  /**
   * `classe` → le libellé de son rayon, pour l'étiquette portée par le contour.
   *
   * Construit depuis le PROFIL et non depuis la tuile : sql/205 n'y écrit pas
   * le rayon, et l'y ajouter imposerait de reconstruire le cache de géométries
   * à chaque anneau déplacé — pour une valeur que le client connaît déjà.
   *
   * Le périmètre publié porte « PPRT » et non une distance : il n'en a pas, sa
   * forme vient d'un arrêté et pas d'un cercle.
   */
  const etiquetteClasse = useMemo(() => {
    const m: unknown[] = ['match', ['get', 'classe']];
    for (const n of NIVEAUX) {
      m.push(`${n}:pprt`, 'PPRT');
      anneauxDuNiveau(profil, n).forEach((r, i) => m.push(`${n}:${i + 1}`, libelleRayon(r)));
    }
    // Défaut vide : une classe inconnue ne doit rien écrire plutôt qu'un
    // libellé inventé — c'est le signe qu'un profil et une tuile divergent.
    m.push('');
    return m;
  }, [profil]);

  /* ── Montage ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!conteneur.current || carte.current) return;
    const m = new maplibregl.Map({
      container: conteneur.current,
      style: FONDS[theme],
      bounds: VUE_INITIALE,
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    m.on('zoom', () => setZoom(m.getZoom()));
    carte.current = m;

    /*
     * ⚠ MapLibre ne redimensionne PAS son canevas tout seul quand son conteneur
     * change de taille sans que la fenêtre bouge — et c'est exactement ce qui
     * arrive ici : la poignée du panneau et le bouton « carte seule » changent
     * la largeur du conteneur, pas celle de la fenêtre. Sans cet observateur,
     * la carte garde ses anciennes dimensions : la moitié droite reste grise et
     * les clics tombent à côté des points.
     */
    const observateur = new ResizeObserver(() => m.resize());
    observateur.observe(conteneur.current);

    return () => { observateur.disconnect(); m.remove(); carte.current = null; };
    // Le thème est relu par l'effet suivant : le remonter ici détruirait la
    // carte à chaque bascule, donc la position de l'utilisateur avec elle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Les zones ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    let annule = false;

    const poser = () => {
      if (annule) return;
      /*
       * ⚠ TOUTES les couches de cette source, sans exception.
       *
       * `removeSource` LÈVE si une seule couche l'utilise encore — et le
       * symptôme est vicieux : l'exception part dans la console, l'ancienne
       * source reste en place, et la carte continue de servir les tuiles du
       * profil PRÉCÉDENT sous la légende du nouveau. Constaté le 2026-09-21,
       * la couche d'étiquettes ajoutée le matin même ne figurait pas dans
       * cette liste.
       *
       * C'est `COUCHES_ZONES` qui la porte désormais, déclarée à côté des
       * identifiants : en ajouter une sans l'y mettre demande de sauter une
       * ligne qui dit exactement pourquoi.
       */
      for (const id of COUCHES_ZONES) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      if (m.getSource(SOURCE_ZONES)) m.removeSource(SOURCE_ZONES);

      /*
       * ⚠ La source porte le profil dans son URL, donc changer de profil impose
       * de la RECRÉER : MapLibre ne permet pas de réécrire l'URL d'une source
       * vectorielle, et la garder servirait indéfiniment les tuiles de l'ancien
       * profil — une carte qui contredit sa propre légende.
       */
      m.addSource(SOURCE_ZONES, {
        type: 'vector',
        tiles: [
          `${window.location.origin}/api/tiles/zones-risque/{z}/{x}/{y}`
          /*
           * ⚠ `codeProfil(profil)` et non `code` : la route valide ce paramètre
           * par `profilDepuisCode`, qui ne sait relire qu'un profil. Les
           * natures voyagent à part, et le serveur recompose la MÊME clé.
           */
          + `?profil=${encodeURIComponent(codeSeul)}`
          + (cleNatures ? `&natures=${encodeURIComponent(cleNatures)}` : ''),
        ],
        minzoom: ZONES_RISQUE_ZOOM_PLANCHER,
        maxzoom: 14,
      });

      /*
       * ⚠ `minzoom` sur la COUCHE, pas sur la source : les tuiles continuent
       * d'être préparées et servies sous ce zoom (le plancher de la source
       * reste `ZONES_RISQUE_ZOOM_PLANCHER`), mais on ne peint rien. Entre z4 et
       * z7, une zone de 2 km tient dans moins d'un pixel : la peindre donne des
       * poussières qu'on prend pour des artefacts, et qui cachent le fond.
       */
      m.addLayer({
        id: ID_FOND,
        type: 'fill',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
        paint: {
          'fill-color': expressionCouleurNiveau(theme) as never,
          // Aplat uni par niveau de loin, bandes détaillées de près.
          'fill-opacity': expressionOpaciteSelonZoom(ZONES_RISQUE_ZOOM_DETAIL) as never,
        },
      });

      // Tireté = zone CALCULÉE par nous. La convention vit une seule fois,
      // dans `lib/carte/nature-zone.ts`, et vaut sur toutes les couches.
      /*
       * ⚠ Le contour des bandes n'apparaît QU'AU DÉTAIL. Sous ce zoom, les
       * anneaux d'un même niveau sont fondus en un aplat : leurs contours y
       * dessineraient des cernes entre des teintes identiques, c'est-à-dire du
       * bruit qui contredit la fusion.
       */
      m.addLayer({
        id: ID_CONTOUR,
        type: 'line',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        minzoom: ZONES_RISQUE_ZOOM_DETAIL,
        filter: ['!=', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE,
          'line-dasharray': TIRETE_ZONE_CALCULEE as never,
          'line-opacity': 0.9,
        },
      });

      // Plein = servitude PUBLIÉE par l'État. Un lecteur doit distinguer
      // l'opposable du calculé sans lire la légende.
      /*
       * Le contour du PPRT, lui, reste visible dès que les zones le sont : ce
       * n'est pas un détail de distance mais une servitude OPPOSABLE, et la
       * seule chose de cette carte qui ne vienne pas d'un rayon que nous avons
       * choisi. La fondre au dézoom effacerait la distinction que toute la
       * légende porte.
       */
      m.addLayer({
        id: ID_PPRT,
        type: 'line',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        minzoom: ZONES_RISQUE_ZOOM_LISIBLE,
        filter: ['==', ['get', 'bande'], null],
        paint: {
          'line-color': expressionCouleurNiveau(theme) as never,
          'line-width': LARGEUR_TRAIT_ZONE + 0.5,
          'line-opacity': 1,
        },
      });

      /*
       * ── L'ÉTIQUETTE DU RAYON, LE LONG DU CONTOUR ────────────────────────
       *
       * ⚠ La tuile ne porte PAS le rayon : sql/205 y écrit `classe`, `niveau`,
       * `bande` et `surface_km2`. Le rayon est une propriété du PROFIL, que le
       * client a sous la main — on compose donc un `match` de `classe` vers son
       * libellé. L'ajouter à la tuile obligerait à reconstruire le cache à
       * chaque déplacement d'anneau, pour une donnée que le client connaît
       * déjà.
       *
       * `symbol-placement: 'line'` fait courir le texte le long du contour :
       * posée au centre, une étiquette par classe s'empilerait avec celles des
       * bandes voisines, toutes concentriques.
       */
      m.addLayer({
        id: ID_ETIQUETTES,
        type: 'symbol',
        source: SOURCE_ZONES,
        'source-layer': 'zones_risque',
        minzoom: ZONES_RISQUE_ZOOM_DETAIL,
        layout: {
          'symbol-placement': 'line',
          'text-field': etiquetteClasse as never,
          // Une police du style OpenFreeMap : demander une fonte absente ferait
          // disparaître TOUT le calque, sans erreur.
          'text-font': ['Noto Sans Regular'],
          'text-size': 10,
          'symbol-spacing': 250,
          // Jamais de chevauchement : deux anneaux proches empileraient leurs
          // étiquettes et aucune ne serait lisible.
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': expressionCouleurNiveau(theme) as never,
          'text-halo-color': HALO_ETIQUETTE[theme],
          'text-halo-width': 1.4,
        },
      });
    };

    /*
     * ⚠ La géométrie est PRÉPARÉE avant qu'on pose la source.
     *
     * Sans cela, MapLibre demanderait ses tuiles sous une clé que personne n'a
     * construite et échouerait en SILENCE sur une source vide — le défaut exact
     * qui a rendu la couche IRIS muette pendant des mois. L'appel est
     * idempotent (`deja_construit: true`) et mesuré à 2 805 ms pour les sept
     * classes du profil par défaut sur la France entière — payé UNE fois par
     * code de profil, jamais à l'affichage ni par tuile.
     */
    const preparerPuisPoser = async () => {
      setPreparation(true);
      try {
        await adminFetch('/api/risques/zones/preparer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Le PROFIL seul dans `profil`, les natures à part : le serveur
          // recompose la clé, pour qu'elle ne puisse pas diverger de celle
          // sous laquelle la couche demandera ses tuiles.
          body: JSON.stringify({
            profil: codeSeul,
            // Reconstruit depuis la forme sérialisée : l'effet ne dépend ainsi
            // que de chaînes, et le linter peut vérifier ses dépendances.
            natures: cleNatures ? cleNatures.split(',') : [],
          }),
        });
      } catch {
        // La carte reste utilisable : le fond et les sites s'affichent, et
        // l'absence de zones se voit. Masquer la carte serait pire.
      }
      if (annule) return;
      setPreparation(false);
      if (m.isStyleLoaded()) poser();
      else m.once('load', poser);
    };

    void preparerPuisPoser();
    return () => { annule = true; };
    /*
     * `etiquetteClasse` dérive du profil, donc de `codeSeul` : l'effet se
     * rejouerait de toute façon. On la déclare quand même — une dépendance
     * vraie qu'on tait aujourd'hui parce qu'une autre la couvre est un piège
     * pour le jour où cette autre disparaît.
     */
  }, [code, codeSeul, cleNatures, theme, etiquetteClasse]);

  /* ── Les sites ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    let annule = false;
    let minuteur: ReturnType<typeof setTimeout> | null = null;

    const charger = async () => {
      const b = m.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        .map((v) => v.toFixed(4)).join(',');
      try {
        const p = new URLSearchParams({ bbox, limite: '800' });
        if (cleGravites) p.set('gravites', cleGravites);
        if (cleNatures) p.set('natures', cleNatures);
        const r = await adminFetch(`/api/map/risques-industriels?${p}`);
        if (!r.ok || annule) return;
        const j = await r.json();
        // La route rend une FeatureCollection telle quelle.
        const fc = j as GeoJSON.FeatureCollection;
        if (annule || !m.getStyle()) return;

        const src = m.getSource(SOURCE_SITES) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          src.setData(fc);
        } else {
          m.addSource(SOURCE_SITES, { type: 'geojson', data: fc });
          m.addLayer({
            id: ID_SITES,
            type: 'circle',
            source: SOURCE_SITES,
            paint: {
              // Le point grossit avec le zoom : à z8 il ne doit pas masquer la
              // zone qu'il engendre, à z13 il doit rester cliquable.
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 13, 5.5],
              /*
               * ⚠ `COULEUR_NIVEAU[theme]` et NON `COULEUR_NIVEAU_CSS`.
               *
               * MapLibre ne résout PAS `var()` dans `paint` — c'est la raison
               * d'être des deux constantes, et de la duplication des palettes
               * divergente et séquentielle (`DESIGN_SYSTEM.md`). Avec les
               * jetons CSS, `addLayer` LÈVE : « Could not parse color from
               * value 'var(--niveau-haut)' », la couche n'est jamais ajoutée,
               * et la légende annonçait pourtant « 58 sites affichés » —
               * `setNSites` ayant réussi, lui. Un compte juste pour des points
               * absents.
               *
               * La légende, elle, est du DOM : elle garde les jetons CSS et
               * suit donc le thème sans recopier une teinte.
               */
              'circle-color': [
                'match', ['get', 'gravite'],
                'seveso_haut', COULEUR_NIVEAU[theme].haut,
                'seveso_bas', COULEUR_NIVEAU[theme].bas,
                COULEUR_NIVEAU[theme].autres,
              ] as never,
              // Cerne INVERSÉ entre thèmes : un cerne blanc sur fond clair ne
              // détoure plus rien, et le point perd ce qui le rend lisible
              // au-dessus d'une zone colorée (`DESIGN_SYSTEM.md`).
              'circle-stroke-color': CONTOUR_POINT[theme],
              'circle-stroke-width': 1,
            },
          });
        }
        // Gardés pour l'aperçu : leurs positions sont déjà là, et les
        // redemander à chaque position du curseur serait absurde.
        sitesRef.current = fc;
        setNSites(Array.isArray(fc?.features) ? fc.features.length : null);
      } catch {
        // Une carte sans ses points reste lisible : les zones sont l'objet.
        // Effacer la couche ferait croire qu'il n'y a plus de site.
      }
    };

    const differer = () => {
      if (minuteur) clearTimeout(minuteur);
      // Un panoramique émet des dizaines d'événements : sans ce délai, chacun
      // partirait en requête et le quota mordrait sur l'usage normal.
      minuteur = setTimeout(() => void charger(), 350);
    };

    /*
     * Une infobulle au clic, et non au survol : sur une grappe dense les
     * points se touchent, et un survol ferait clignoter l'écran au moindre
     * déplacement de souris.
     */
    const surClic = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, unknown>;
      const niveau = p.gravite === 'seveso_haut' ? 'haut'
        : p.gravite === 'seveso_bas' ? 'bas' : 'autres';
      // `textContent` plutôt qu'une chaîne HTML : les noms de sites viennent
      // d'un import tiers, et un `<` y suffirait à casser le contenu — ou pire.
      const bloc = document.createElement('div');
      bloc.style.fontFamily = fInter;
      bloc.style.fontSize = '11.5px';
      bloc.style.lineHeight = '1.55';
      const titre = document.createElement('div');
      titre.style.fontWeight = '500';
      titre.style.marginBottom = '2px';
      titre.textContent = String(p.nom ?? 'Site sans nom');
      const detail = document.createElement('div');
      detail.style.color = 'var(--text-tertiary)';
      detail.textContent = [
        p.statut_seveso, p.ville, p.libelle_nature,
      ].filter(Boolean).map(String).join(' · ');
      bloc.append(titre, detail);

      new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
        .setLngLat(e.lngLat)
        .setDOMContent(bloc)
        .addTo(m);
      void niveau;
    };
    /*
     * ── SURVOL : LES ANNEAUX DU SITE, EN TRAIT FIN ──────────────────────
     *
     * Les zones peintes sont EXCLUSIVES — un carreau couvert par deux sites
     * n'appartient qu'à une classe, et l'aplat ne dit donc pas de quel site
     * vient le sien. Le survol répond à cette question, et à elle seule :
     * voici ce que CE site engendre.
     *
     * ⚠ Calculé côté client, sans aucune requête : les rayons sont ceux du
     * profil, la position est déjà dans la tuile GeoJSON. Un survol qui
     * appellerait le serveur émettrait des dizaines de requêtes par mouvement
     * de souris sur une grappe dense.
     */
    const dessinerSurvol = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const g = f?.geometry;
      if (!f || !g || g.type !== 'Point') return;
      const [lon, lat] = g.coordinates as [number, number];
      const gravite = String((f.properties as Record<string, unknown>).gravite ?? '');
      const niveau: Niveau = gravite === 'seveso_haut' ? 'haut'
        : gravite === 'seveso_bas' ? 'bas' : 'autres';

      const cercles = anneauxDuNiveau(profilRef.current, niveau)
        .map((r) => circleGeoJSON(lon, lat, r));
      const src = m.getSource(SOURCE_SURVOL) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: cercles });
    };

    const effacerSurvol = () => {
      const src = m.getSource(SOURCE_SURVOL) as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features: [] });
    };

    m.on('click', ID_SITES, surClic);
    m.on('mousemove', ID_SITES, dessinerSurvol);
    m.on('mouseenter', ID_SITES, () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', ID_SITES, () => { m.getCanvas().style.cursor = ''; effacerSurvol(); });

    m.on('moveend', differer);
    if (m.isStyleLoaded()) void charger();
    else m.once('load', () => void charger());

    return () => {
      annule = true;
      if (minuteur) clearTimeout(minuteur);
      m.off('moveend', differer);
      m.off('click', ID_SITES, surClic);
      m.off('mousemove', ID_SITES, dessinerSurvol);
    };
  }, [cleGravites, cleNatures, theme]);

  /* ── L'aperçu pendant le glissement de la réglette ─────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    const src = m.getSource(SOURCE_APERCU) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!apercu) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const sites = sitesRef.current?.features ?? [];
    /*
     * ⚠ Plafonné, et le chiffre est réfléchi : 64 segments par cercle, un
     * cercle par site, reconstruits à chaque position du curseur. À 800 sites
     * cela ferait 51 200 points par image — le glissement saccaderait, sur un
     * écran qui porte déjà une carte WebGL. Les sites sont déjà bornés à la
     * bbox visible ; ce plafond n'agit que sur les grappes les plus denses,
     * où la centième couronne n'apprend plus rien.
     */
    const retenus: GeoJSON.Feature[] = [];
    for (const f of sites) {
      if (retenus.length >= APERCU_SITES_MAX) break;
      const g = f.geometry;
      if (!g || g.type !== 'Point') continue;
      const gravite = String((f.properties as Record<string, unknown>)?.gravite ?? '');
      const niveau: Niveau = gravite === 'seveso_haut' ? 'haut'
        : gravite === 'seveso_bas' ? 'bas' : 'autres';
      // `null` = niveaux liés : le réglage vaut pour tous, donc on les dessine
      // tous. Sinon, seul le niveau qu'on règle bouge — dessiner les autres
      // montrerait un changement qui n'a pas lieu.
      if (apercu.niveau !== null && apercu.niveau !== niveau) continue;
      const [lon, lat] = g.coordinates as [number, number];
      retenus.push(circleGeoJSON(lon, lat, apercu.rayonM));
    }
    src.setData({ type: 'FeatureCollection', features: retenus });
  }, [apercu]);

  /* ── La couche de survol ───────────────────────────────────────────────── */
  useEffect(() => {
    const m = carte.current;
    if (!m) return;
    const poser = () => {
      if (m.getSource(SOURCE_SURVOL)) return;

      /*
       * ── L'APERÇU DE RÉGLAGE ──────────────────────────────────────────
       * Posé sous le survol : quand on règle en survolant un site, c'est le
       * site survolé qu'on veut distinguer, pas la nappe d'aperçu.
       *
       * ⚠ **`line` et non `fill`, et c'est une mesure.**
       *
       * L'aperçu dessine UN CERCLE PAR SITE — jusqu'à `APERCU_SITES_MAX`, et
       * 42 sur une vue de l'Étang de Berre. En `fill`, deux cercles qui se
       * recouvrent mélangent leur alpha : le recouvrement devient plus sombre,
       * et une grappe dense vire au rouge plein. On lit alors une intensité là
       * où il n'y a qu'une densité de sites — l'inverse exact de ce que les
       * vraies zones racontent, elles qui sont exclusives (sql/205, vérifié à
       * 0,00 m² de recouvrement) et dont l'opacité encode la DISTANCE.
       *
       * Deux fausses pistes écartées, mesurées le 2026-09-21 :
       * — réunir les cercles en UN SEUL `MultiPolygon` ne change rien, earcut
       *   triangule chaque polygone séparément et l'alpha se mélange quand
       *   même (comparé à l'écran, les deux rendus sont identiques) ;
       * — les fusionner côté client demanderait une bibliothèque géométrique,
       *   que ce projet n'embarque pas — et les fusionner côté serveur serait
       *   une requête par position du curseur, la famille de l'incident du
       *   28/03.
       *
       * Un contour ne s'empile pas : il n'a pas de surface. Et il dit mieux ce
       * que l'aperçu EST — une étendue en cours de réglage, jamais une zone
       * établie. Les vraies portent un aplat, une opacité par bande et un
       * contour par classe ; celle-ci n'a qu'un trait.
       */
      m.addSource(SOURCE_APERCU, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: ID_APERCU,
        type: 'line',
        source: SOURCE_APERCU,
        paint: {
          'line-color': COULEUR_NIVEAU[theme].haut,
          'line-width': 1.5,
          'line-opacity': 0.9,
        },
      });

      m.addSource(SOURCE_SURVOL, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: ID_SURVOL,
        type: 'line',
        source: SOURCE_SURVOL,
        paint: {
          // Blanc/noir selon le thème plutôt que la teinte du niveau : ces
          // cercles se superposent aux zones DE CETTE MÊME teinte, et s'y
          // fondraient exactement là où on veut les distinguer.
          'line-color': CONTOUR_POINT[theme],
          'line-width': 1,
          'line-opacity': 0.85,
        },
      });
    };
    if (m.isStyleLoaded()) poser();
    else m.once('load', poser);
  }, [theme]);

  /*
   * ⚠ Le seuil de LISIBILITÉ, pas le plancher de la source.
   *
   * Le bandeau se déclenchait sous `ZONES_RISQUE_ZOOM_PLANCHER` (z4), donc
   * quasiment jamais — et entre z4 et z7 la carte peignait des zones de moins
   * d'un pixel sans rien dire. C'est exactement le cas où l'utilisateur croit
   * qu'il n'y a rien à voir.
   */
  const sousLeSeuilLisible = zoom < ZONES_RISQUE_ZOOM_LISIBLE;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={conteneur} style={{ position: 'absolute', inset: 0 }} />

      {/* ── Aller voir une grappe ─────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', top: 10, left: 10, zIndex: 2,
          display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 'calc(100% - 100px)',
        }}
      >
        {GRAPPES.map((g) => (
          <button
            key={g.nom}
            type="button"
            onClick={() => carte.current?.fitBounds(
              [[g.bbox[0], g.bbox[1]], [g.bbox[2], g.bbox[3]]],
              { padding: 40, duration: 800 },
            )}
            style={{
              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              fontFamily: fInter, fontSize: 11,
              background: 'var(--card-overlay)',
              border: '0.5px solid var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            {g.nom}
          </button>
        ))}
      </div>

      {/* ── Légende ──────────────────────────────────────────────────────
          Elle ne liste QUE les niveaux qui portent un anneau : une entrée
          vide se lirait « aucun habitant à ce niveau », alors qu'elle
          signifie « ce niveau n'est pas calculé ». */}
      <div
        style={{
          position: 'absolute', bottom: 10, left: 10, zIndex: 2,
          padding: '9px 11px', borderRadius: 8, maxWidth: 260,
          background: 'var(--card-overlay)',
          border: '0.5px solid var(--border-subtle)',
        }}
      >
        {NIVEAUX.map((n) => {
          const anneaux = anneauxDuNiveau(profil, n as Niveau);
          if (anneaux.length === 0) return null;
          return (
            <div key={n} style={{ marginBottom: 6 }}>
              <div style={{ fontFamily: fInter, fontSize: 10.5, color: 'var(--text-secondary)', marginBottom: 3 }}>
                {LIBELLE_NIVEAU[n as Niveau]}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {anneaux.map((r, i) => (
                  <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 13, height: 13, borderRadius: 3,
                        background: COULEUR_NIVEAU_CSS[n as Niveau],
                        opacity: OPACITE_BANDE[Math.min(i, OPACITE_BANDE.length - 1)],
                        border: `0.5px solid ${COULEUR_NIVEAU_CSS[n as Niveau]}`,
                      }}
                    />
                    <span style={{ fontFamily: fMono, fontSize: 9.5, color: 'var(--text-tertiary)' }}>
                      {libelleRayon(r)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ fontFamily: fInter, fontSize: 9.5, color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: 2 }}>
          Trait plein : périmètre publié par l’État. Tireté : rayon que nous
          calculons.
          {nSites !== null && ` · ${formaterNombre(nSites)} sites affichés`}
        </div>
      </div>

      {/* ── Sous le plancher ─────────────────────────────────────────────
          MapLibre ne demande AUCUNE tuile sous le minzoom d'une source, et
          n'émet aucune erreur : sans ce bandeau, la carte paraîtrait vide
          alors qu'elle n'a simplement rien demandé. */}
      {sousLeSeuilLisible && (
        <div
          style={{
            position: 'absolute', top: 50, left: 10, zIndex: 2,
            padding: '7px 11px', borderRadius: 6, maxWidth: 300,
            background: 'rgba(247,183,49,0.12)',
            border: '0.5px solid rgba(247,183,49,0.25)',
            fontFamily: fInter, fontSize: 11, color: 'var(--warning)', lineHeight: 1.5,
          }}
        >
          Zoomez pour voir les zones : à cette échelle, un rayon de 2 km fait
          moins d’un pixel.
        </div>
      )}

      {preparation && (
        <div
          style={{
            position: 'absolute', top: 10, right: 56, zIndex: 2,
            padding: '6px 10px', borderRadius: 6,
            background: 'var(--card-overlay)',
            border: '0.5px solid var(--border-subtle)',
            fontFamily: fInter, fontSize: 10.5, color: 'var(--text-secondary)',
          }}
        >
          Découpage des zones…
        </div>
      )}

      {/*
        ⚠ Le bandeau « construisez le jeu pour en tirer des codes postaux »
        vivait ICI et a rejoint le panneau de l'étape ④ (2026-09-21). C'est une
        consigne sur le geste suivant, et le bouton qui l'exécute est dans ce
        panneau : la carte est désormais commune aux quatre étapes, et elle
        aurait porté sur les trois autres un conseil sans rapport avec ce qu'on
        y fait.
      */}
    </div>
  );
}

'use client';
import { logger } from '@/lib/logger';

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import {
  ISOCHRONE_COLORS,
  VORONOI_PALETTE,
  BATTLE_PALIER_OPACITY,
} from '../_lib/constants';
import { CARREAUX_PALETTES } from '@/lib/carreaux/catalogue';
import { denominateurDe } from '@/lib/carreaux/normalisation';
import { bornesDe, palierEchelle, PLANCHER_LOG } from '@/lib/carreaux/bornes';
import type { BornesEchelle } from '@/lib/carreaux/bornes';
import { bornesInternes, donneeExploitableExpr,
  hauteurExtrusionExpr, COULEUR_DONNEE_ABSENTE } from '@/lib/carreaux/expressions';
import { echelleDe, echelleLogExpr, donneeIrisExploitableExpr,
  type BornesIris, type CatalogueBornesIris } from '@/lib/iris/echelle';
import type { IsochroneData, CarreauxData } from '@/types/spatial';
import { IRIS_ZOOM_PLANCHER } from '@/lib/version';
import type { DegradeId } from '@/lib/carte/degrades';
import { basculerDegrade as basculerDegradePur } from '@/lib/carte/calques-actifs';

// ── Carreaux — normalisation (densité / moyenne) ───────────────────────────────
// La cascade de `get_tile` (sql/129) sert des mailles de 200 m, 2 km, 5 km ou 20 km :
// un effectif brut n'est donc PAS comparable d'un palier à l'autre (facteur 70
// entre 2 km et 200 m). Couleur, filtre par palier et bornes de légende doivent
// tous lire la MÊME valeur normalisée, sinon ils se contredisent en silence.
//
// Les BORNES de l'échelle, elles, ne sont plus mesurées sur les features rendues :
// elles viennent de `lib/carreaux/bornes.ts` (bornes nationales constantes).
// C'est ce qui rend deux territoires comparables — une densité donne la même
// couleur où qu'on soit sur la carte.
//
// Et l'échelle est LOGARITHMIQUE. La normalisation rend les unités comparables,
// pas les distributions : la même grandeur s'étend sur plus de 4 décades entre un
// carreau rural de 5 km et un carreau de 200 m dans Paris. Mesuré en base, des
// bornes fixes LINÉAIRES saturaient 99,5 % des carreaux de Paris au zoom ≥ 10 —
// un aplat monochrome, pire que le défaut d'origine. En log10, chaque palier
// récupère un vrai dégradé.

/**
 * Expression MapLibre du quotient `indicateur / dénominateur`, évaluée par le
 * moteur de rendu feature par feature (`fill-color` et `fill-opacity`).
 *
 * `max(dénominateur, 0.0001)` protège la division : un carreau sans habitant
 * produirait sinon `Infinity`, qu'`interpolate` rejette sans lever d'exception.
 *
 * Un `case`/`coalesce` serait parfaitement légal ici — ces expressions sont
 * évaluées par MapLibre côté CPU, pas en GLSL. Le choix du `max` est celui de
 * l'indivisibilité : couleur (`fill-color`) et filtre par palier
 * (`fill-opacity`) lisent cette seule fonction, donc la même valeur. Toute
 * logique supplémentaire serait une occasion de les faire diverger — et leur
 * divergence ne lève aucune erreur, elle ne se voit qu'à l'œil.
 */
function carreauxNormaliseExpr(ind: string): maplibregl.ExpressionSpecification {
  const denom = denominateurDe(ind);
  return ['/',
    ['to-number', ['get', ind], 0],
    ['max', ['to-number', ['get', denom], 0], 0.0001],
  ] as unknown as maplibregl.ExpressionSpecification;
}

/**
 * Expression MapLibre de la valeur telle que l'échelle la lit : le **log10** du
 * quotient normalisé.
 *
 * `max(quotient, PLANCHER_LOG)` protège l'entrée du log exactement comme le
 * `max` du dénominateur protège la division : `log10(0)` vaut `-Infinity`, et
 * `interpolate` rejette `-Infinity` sans lever d'exception — la couche reste
 * alors sans couleur, sans erreur, sans trace.
 *
 * Point d'entrée UNIQUE de l'échelle : `fill-color` (la couleur) et
 * `fill-opacity` (le filtre par palier) passent tous deux par ici, donc lisent
 * la même valeur. C'est la seule garantie qu'une tranche de légende désigne bien
 * les carreaux que le filtre sélectionne — leur divergence ne lèverait aucune
 * erreur, elle ne se verrait qu'à l'œil.
 */
function carreauxEchelleExpr(ind: string): maplibregl.ExpressionSpecification {
  return ['log10',
    ['max', carreauxNormaliseExpr(ind), PLANCHER_LOG],
  ] as unknown as maplibregl.ExpressionSpecification;
}

// L'extraction JS des valeurs normalisées des features rendues
// (`carreauxValeursNormalisees`) a été retirée avec les percentiles de viewport :
// plus aucun point de calcul ne lit les features, donc elle n'avait plus
// d'appelant. Son rôle — garantir que les bornes lisent la même valeur que la
// couleur — est désormais tenu en amont, par la normalisation appliquée au
// calcul des bornes nationales (cf. sql/123).

// ── IRIS — palettes + types ───────────────────────────────────────────────────
export const IRIS_PALETTES = [
  { id: 'bleu',    label: 'Bleu',    stops: ['#F7FBFF','#C6DBEF','#9ECAE1','#4292C6','#2171B5','#08306B'] },
  { id: 'violet',  label: 'Violet',  stops: ['#F2F0F7','#DADAEB','#BCBDDC','#9E9AC8','#756BB1','#54278F'] },
  { id: 'vert',    label: 'Vert',    stops: ['#F7FCF5','#C7E9C0','#74C476','#41AB5D','#238B45','#00441B'] },
  { id: 'chaleur', label: 'Chaleur', stops: ['#FAEEDA','#FAC775','#EF9F27','#D85A30','#993C1D','#501313'] },
  { id: 'rouge',   label: 'Rouge',   stops: ['#FFF5F0','#FEE0D2','#FCBBA1','#FC9272','#DE2D26','#A50F15'] },
  { id: 'turbo',   label: 'Turbo',   stops: ['#30123b','#4675ed','#1bcfd4','#61fc6c','#f6a91b','#c42503'] },
  { id: 'plasma',  label: 'Plasma',  stops: ['#0d0887','#6a00a8','#b12a90','#e16462','#fca636','#f0f921'] },
];

interface UseMapLayersOpts {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
}

export function useMapLayers({
  mapRef,
  mapReady,
}: UseMapLayersOpts) {
  // Bataille d'Isochrones
  const [battleVisible,          setBattleVisible]          = useState(false);
  const [battleCategory,         setBattleCategory]         = useState('');
  const [battlePois,           setBattlePois]           = useState<{ id: string; nom: string; color: string }[]>([]);
  const [battleOuterFillVisible, setBattleOuterFillVisible] = useState(false);
  const [battleMaxPalier,        setBattleMaxPalier]        = useState(90);

  // Test ORS
  const [testIsoVisible, setTestIsoVisible] = useState(false);
  const [testIsoLoading, setTestIsoLoading] = useState(false);
  const [testIsoDebug,   setTestIsoDebug]   = useState('');

  // Isochrones
  const [isochroneVisible,   setIsochroneVisible]   = useState(false);
  const [isochroneMode,      setIsochroneMode]      = useState('walk');
  const [isochroneMinutes,   setIsochroneMinutes]   = useState(0);
  const [isochroneFromCache, setIsochroneFromCache] = useState(false);
  const [isochroneCachedAt,  setIsochroneCachedAt]  = useState('');
  const lastIsochroneDataRef = useRef<IsochroneData | null>(null);

  // Carreaux — visibility state only; MVT layers managed by useMapInit
  const [carreauxVisible,        setCarreauxVisible]        = useState(false);
  const [carreauxLoaded,         setCarreauxLoaded]         = useState(true);
  const [carreauxIndicateur,     setCarreauxIndicateur]     = useState('population_totale');
  const [carreauxLabel,          setCarreauxLabel]          = useState('Population totale');
  const [carreauxPalette,        _setCarreauxPalette]       = useState('rouge');
  const [carreauxOpacity,        _setCarreauxOpacity]       = useState(0.72);
  const [carreauxRange,          setCarreauxRange]          = useState<BornesEchelle | null>(null);
  const [carreauxSelectedBucket, _setCarreauxSelectedBucket] = useState<number | null>(null);
  const carreauxSourcesRef = useRef<{ tableName: string; name: string }[]>([]);
  // Refs to always have current values without stale closures
  const carreauxIndicateurRef = useRef('population_totale');
  // Range mémorisé pour réappliquer la palette sans re-query (déclaré ici pour usage dans les effects)
  const carreauxRangeRef = useRef<{ ind: string; min: number; max: number } | null>(null);
  // Opacity ref — mir ror de _setCarreauxOpacity, accessible sans stale closure
  const carreauxOpacityRef = useRef(0.72);
  // 3D : hauteur maximale en metres, atteinte par la borne nationale HAUTE.
  // 4 000 m par defaut — a la latitude de la France et aux zooms ou la 3D est
  // lisible (z >= 8), cela donne un relief net sans que les colonnes urbaines
  // masquent la moitie de la carte derriere elles.
  const [carreaux3D, _setCarreaux3D] = useState(false);
  const carreaux3DRef = useRef(false);
  // Exageration du relief : multiple de la largeur de maille (et non des
  // metres — voir applyCarreauxHauteur). 1,5x lit comme un relief sans que les
  // colonnes se masquent entre elles.
  const [carreauxHauteur, _setCarreauxHauteur] = useState(1.5);
  const carreauxHauteurRef = useRef(1.5);

  // Relief 3D des IRIS. Meme grandeur que pour les carreaux : un multiple de la
  // largeur de maille, jamais des metres absolus.
  const [iris3D, _setIris3D] = useState(false);
  const iris3DRef = useRef(false);
  const [irisHauteur, _setIrisHauteur] = useState(1.5);
  const irisHauteurRef = useRef(1.5);
  const pitchAvantIris3DRef = useRef(0);
  // Bucket info ref — pour que setCarreauxOpacity puisse réappliquer le bon filtre
  const carreauxBucketInfoRef = useRef<{ bucket: number; min: number; max: number; ind: string } | null>(null);

  // ── IRIS choroplèthe ─────────────────────────────────────────────────────────
  const [irisVisible,   _setIrisVisible]    = useState(false);
  const irisVisibleRef                      = useRef(false);
  const [irisChoro,      setIrisChoro]      = useState(true);  // false = contours seuls
  const [irisIndicateur, setIrisIndicateur] = useState('pop_15_29');
  const [irisPalette,    _setIrisPalette]   = useState('bleu');
  const [irisOpacity,    _setIrisOpacity]   = useState(0.45);
  // Bornes nationales de la colonne affichee. Remplacent `irisStats` : les
  // percentiles par bbox coutaient un balayage complet d'`iris` PAR COLONNE.
  const [irisBornes,     setIrisBornes]     = useState<BornesIris | null>(null);
  // `false` par défaut, et c'est la règle de CLAUDE.md : `is_true_iris = true`
  // sert l'analyse statistique, JAMAIS l'affichage. Le défaut était `true`, et
  // masquait donc toute la France rurale — mesuré sur une tuile z10 rurale :
  // 50 IRIS présents, ZÉRO passant le filtre. Une carte vide sur les trois
  // quarts du territoire, sans rien pour l'expliquer.
  const [irisTrueOnly,   setIrisTrueOnly]   = useState(false);

  const irisIndicateurRef = useRef('pop_15_29');
  const irisPaletteRef    = useRef('bleu');
  const irisOpacityRef    = useRef(0.45);
  // Cache stats par colonne — chargées une à la fois (lazy, on-demand)
  const irisBornesCacheRef = useRef<CatalogueBornesIris | null>(null);
  const irisChoroRef      = useRef(true);

  useEffect(() => { irisIndicateurRef.current = irisIndicateur; }, [irisIndicateur]);
  useEffect(() => { irisPaletteRef.current    = irisPalette;    }, [irisPalette]);
  useEffect(() => { irisChoroRef.current      = irisChoro;      }, [irisChoro]);

  // ── Visibility toggles ────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = battleVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('battle-fill',         'visibility', vis);
      map.setLayoutProperty('battle-ring-line',    'visibility', vis);
      map.setLayoutProperty('battle-cirfa-border', 'visibility', vis);
      map.setLayoutProperty('battle-pois-halo',    'visibility', vis);
      map.setLayoutProperty('battle-pois-circle',  'visibility', vis);
    } catch { /* layer pas encore prêt */ }
  }, [battleVisible, mapReady, mapRef]);

  // Filtre outer fill (palier=0) selon battleOuterFillVisible
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const baseFilter = ['!=', ['get', 'feature_type'], 'border'];
    const outerFilter = battleOuterFillVisible
      ? baseFilter
      : ['all', baseFilter, ['!=', ['get', 'palier'], 0]];
    try {
      map.setFilter('battle-fill',      outerFilter as unknown as maplibregl.FilterSpecification);
      map.setFilter('battle-ring-line', outerFilter as unknown as maplibregl.FilterSpecification);
    } catch { /* layer pas encore prêt */ }
  }, [battleOuterFillVisible, mapReady, mapRef]);

  // Filtre palier max — cache les anneaux au-delà du palier sélectionné
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const filter = ['all',
      ['!=', ['get', 'feature_type'], 'border'],
      ['any',
        ['==', ['get', 'palier'], 0],  // outer fill toujours inclus
        ['<=', ['get', 'palier'], battleMaxPalier],
      ],
    ];
    try {
      map.setFilter('battle-fill',      filter as unknown as maplibregl.FilterSpecification);
      map.setFilter('battle-ring-line', filter as unknown as maplibregl.FilterSpecification);
    } catch { /* layer pas encore prêt */ }
  }, [battleMaxPalier, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = testIsoVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('test-iso-fill', 'visibility', vis);
      map.setLayoutProperty('test-iso-line', 'visibility', vis);
    } catch {}
  }, [testIsoVisible, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = isochroneVisible ? 'visible' : 'none';
    try {
      map.setLayoutProperty('isochrones-fill', 'visibility', vis);
      map.setLayoutProperty('isochrones-line', 'visibility', vis);
    } catch { /* layer pas encore ajouté */ }
  }, [isochroneVisible, mapReady, mapRef]);

  // Keep indicateur ref in sync with state + reset bucket/range/fill-color on change
  useEffect(() => {
    carreauxIndicateurRef.current = carreauxIndicateur;
    _setCarreauxSelectedBucket(null);
    setCarreauxRange(null);
    carreauxRangeRef.current = null;
    const map = mapRef.current;
    if (map) {
      try {
        // Restaurer l'opacité statique (plus de setFilter — voir applyBucketOpacity)
        map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity', carreauxOpacityRef.current);
        map.setPaintProperty('carreaux-mvt-line', 'line-opacity', 0.35);
        map.setPaintProperty('carreaux-mvt-fill', 'fill-color', '#FC9272');
      } catch { /* ok */ }
    }
  }, [carreauxIndicateur, mapRef]);

  // ── Carreaux MVT — visibilité ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Les couches plate et extrudee ne sont jamais visibles ensemble : leurs
    // geometries sont coplanaires a la base, ce qui produit du z-fighting.
    const plat = carreauxVisible && !carreaux3D ? 'visible' : 'none';
    const relief = carreauxVisible && carreaux3D ? 'visible' : 'none';
    try {
      map.setLayoutProperty('carreaux-mvt-fill', 'visibility', plat);
      map.setLayoutProperty('carreaux-mvt-line', 'visibility', plat);
      map.setLayoutProperty('carreaux-mvt-extrusion', 'visibility', relief);
    } catch { /* ok */ }
  }, [carreauxVisible, carreaux3D, mapReady, mapRef]);

  // Applique fill-color avec les stops + range stocké
  const applyCarreauxColor = useCallback((
    map: maplibregl.Map,
    paletteId: string,
    ind: string,
    bornes: BornesEchelle,
  ) => {
    if (!map.getLayer('carreaux-mvt-fill')) return;
    const pal = CARREAUX_PALETTES.find(p => p.id === paletteId) ?? CARREAUX_PALETTES[0];
    const etendue = bornes.max - bornes.min;
    if (etendue <= 0) return;
    // safeNum : log10 de la valeur NORMALISÉE (densité/km² ou moyenne par
    // individu/ménage), pas l'effectif brut — sinon une même couleur désigne une
    // densité différente de part et d'autre d'un changement de palier de maille.
    // Le log10 est ce qui empêche la queue urbaine dense de saturer tout le haut
    // de la palette (mesuré : 99,5 % de Paris en linéaire).
    // null-safe : les to-number internes garantissent un type statique `number`,
    // pour qu'interpolate ne reçoive pas un Value/unknown depuis ['get', …].
    const safeNum = carreauxEchelleExpr(ind);
    // `step` (et non `interpolate`) : les frontières viennent de `palierEchelle`
    // via `bornesInternes`, l'unique découpage aussi lu par la légende
    // (CarreauxSection) et par le filtre par palier (applyBucketOpacity). Un
    // `interpolate` à arrêts posés à `k/5` de l'étendue peignait un dégradé
    // continu que la légende, elle, découpait en `k/6` : une pastille pouvait
    // annoncer une teinte que la carte n'employait pas dans cette tranche. Le
    // `step` traite d'office les valeurs sous `bornes.min` comme `stops[0]`
    // (MapLibre applique la valeur d'entrée en dessous de la première
    // frontière), ce que l'`interpolate` faisait aussi par clamp — mais que le
    // filtre par palier, lui, ne faisait pas encore (cf. applyBucketOpacity).
    const frontieres = bornesInternes(bornes, 6);
    // Le `case` en amont du `step` distingue « valeur nulle » de « donnée
    // absente ». Sans lui, un indicateur manquant se peint au bas de l'échelle
    // (la carte affirme « personne n'habite ici ») et une superficie manquante
    // divise par 0,0001, soit une densité multipliée par 10 000 — le carreau
    // ressort comme le plus dense de France. Aucun des deux cas ne se produit
    // aujourd'hui : `get_tile` émet toujours les colonnes. C'est un garde-fou
    // pour le jour où une tuile en cache précède un changement de schéma.
    const expr = ['case',
      donneeExploitableExpr(ind, denominateurDe(ind)),
      ['step', safeNum, pal.stops[0],
        ...frontieres.flatMap((b, i) => [b, pal.stops[i + 1]]),
      ],
      COULEUR_DONNEE_ABSENTE,
    ] as unknown as maplibregl.ExpressionSpecification;
    try { map.setPaintProperty('carreaux-mvt-fill', 'fill-color', expr); } catch { /* ok */ }
    // La couche extrudee porte la MEME couleur : basculer en 3D ne doit pas
    // changer la lecture, seulement l'axe sur lequel on la lit.
    try { map.setPaintProperty('carreaux-mvt-extrusion', 'fill-extrusion-color', expr); } catch { /* ok */ }
  }, []);

  /**
   * Hauteur des colonnes 3D.
   *
   * Meme entree que la couleur — le log10 de la valeur normalisee — et MEMES
   * bornes nationales. Une colonne deux fois plus haute qu'une autre designe
   * donc le meme ecart que deux crans de palette, et un territoire garde sa
   * silhouette d'une carte a l'autre.
   *
   * ── Pourquoi l'exageration est un MULTIPLE DE LA MAILLE, et non des metres
   *
   * La reglette donnait une hauteur en metres absolus, identique a tous les
   * zooms. Or la maille, elle, change cinq fois de taille dans la cascade
   * (20 km -> 200 m). Mesure faite le 2026-09-11 a 46 deg de latitude, pitch
   * 60 deg, pour le reglage par defaut de 4 km :
   *
   *   zoom  4 : colonne 1 px pour une maille de 6 px   -> 0,2x — relief INVISIBLE
   *   zoom  8 : colonne 16 px pour une maille de 9 px  -> 1,7x
   *   zoom 12 : colonne 261 px pour une maille de 15 px -> 17,3x — foret d'aiguilles
   *
   * Un facteur 87 entre les deux extremites, pour un reglage inchange. Aucune
   * plage de metres ne pouvait convenir : la grandeur elle-meme etait fausse.
   *
   * `exagerationMaille` est desormais un multiple de la LARGEUR DE MAILLE, lue
   * sur `superficie_km2` que `get_tile` pose sur chaque feature. Le rapport
   * colonne/maille devient constant a tous les zooms, et le front n'a pas
   * besoin de connaitre la cascade SQL — qui a deja change deux fois.
   *
   * Pas d'`interpolate` ici : ses sorties seraient des expressions
   * data-driven, ce que MapLibre accepte mal. Le meme resultat — lineaire,
   * borne aux deux bouts — s'ecrit avec `min`/`max`, et se lit mieux. Le
   * plafonnement est voulu : sans lui, une poignee de carreaux parisiens
   * ecraserait tout le reste du relief.
   */
  const applyCarreauxHauteur = useCallback((
    map: maplibregl.Map,
    ind: string,
    bornes: BornesEchelle,
    exagerationMaille: number,
  ) => {
    if (!map.getLayer('carreaux-mvt-extrusion')) return;
    if (bornes.max - bornes.min <= 0) return;
    // L'expression vit dans `lib/carreaux/expressions.ts` — c'est la seule
    // facon de la tester : un hook ne s'evalue pas en test unitaire, et c'est
    // precisement le calcul qui devait etre prouve.
    const expr = hauteurExtrusionExpr(
      ind, denominateurDe(ind), bornes, exagerationMaille, carreauxEchelleExpr(ind),
    ) as unknown as maplibregl.ExpressionSpecification;
    try { map.setPaintProperty('carreaux-mvt-extrusion', 'fill-extrusion-height', expr); } catch { /* ok */ }
  }, []);

  // ── Setters directs — applique immédiatement sans passer par les effects ──

  // Les bornes sont nationales et constantes : plus de branche « cache sinon
  // queryRenderedFeatures ». Un changement de palette ne change que les
  // couleurs, jamais l'échelle — c'est pourquoi il n'y a plus rien à mesurer.
  const setCarreauxPalette = useCallback((paletteId: string) => {
    logger.debug('palette', `click ${paletteId} map: ${!!mapRef.current}`);
    _setCarreauxPalette(paletteId);
    const map = mapRef.current;
    if (!map) { console.warn('[palette] no map'); return; }
    const ind = carreauxIndicateurRef.current;
    const bornes = bornesDe(ind);
    // Garde conservée : une expression `interpolate` à bornes non strictement
    // croissantes est rejetée EN SILENCE par MapLibre — couche sans couleur,
    // sans erreur.
    if (bornes.max <= bornes.min) return;
    carreauxRangeRef.current = { ind, ...bornes };
    setCarreauxRange(bornes);
    applyCarreauxColor(map, paletteId, ind, bornes);
    applyCarreauxHauteur(map, ind, bornes, carreauxHauteurRef.current);
    logger.debug('palette', `applied national bornes log10 ${bornes.min} → ${bornes.max}`);
  }, [mapRef, applyCarreauxColor, applyCarreauxHauteur]);

  // ── Helper : applique l'opacité bucket via setPaintProperty (pas setFilter) ──
  // Raison : setFilter s'exécute dans le worker MapLibre (_parseWorkerTile) avec
  // un type checker strict qui rejette Value → "Expected number, found null" → tuile droppée.
  // setPaintProperty s'évalue au render time dans le thread principal → pas de crash.
  const applyBucketOpacity = useCallback((
    map: maplibregl.Map,
    info: { bucket: number; min: number; max: number; ind: string } | null,
    opacity: number,
  ) => {
    if (!map.getLayer('carreaux-mvt-fill')) return;
    if (!info) {
      try {
        map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity', opacity);
        map.setPaintProperty('carreaux-mvt-line', 'line-opacity', 0.35);
      } catch { /* ok */ }
      return;
    }
    const { bucket, min, max, ind } = info;
    // min/max viennent de palierEchelle, donc de bornes NORMALISÉES et en LOG10 :
    // comparer à la valeur brute, ou à sa densité non logarithmée,
    // sélectionnerait les mauvais carreaux. Même expression que fill-color.
    const val = carreauxEchelleExpr(ind);
    // Le palier 0 est ouvert vers le bas comme le palier 5 est ouvert vers le
    // haut : sinon les carreaux sous `bornes.min` sont peints (fill-color les
    // clampe sur `stops[0]`, cf. applyCarreauxColor) mais introuvables au clic
    // sur la première tranche de la légende.
    const inBucket = (bucket === 0
      ? ['<', val, max]
      : bucket === 5
        ? ['>=', val, min]
        : ['all', ['>=', val, min], ['<', val, max]]
    ) as unknown as maplibregl.ExpressionSpecification;
    try {
      map.setPaintProperty('carreaux-mvt-fill', 'fill-opacity',
        ['case', inBucket, opacity, 0] as unknown as maplibregl.ExpressionSpecification);
      map.setPaintProperty('carreaux-mvt-line', 'line-opacity',
        ['case', inBucket, 0.35, 0] as unknown as maplibregl.ExpressionSpecification);
    } catch { /* ok */ }
  }, []);

  /** Inclinaison rendue au relief, en degres. Au-dela, les colonnes du premier
   *  plan masquent tout le fond de carte ; en deca de ~40 deg, le relief se
   *  devine a peine. */
  const PITCH_RELIEF = 55;

  /** Inclinaison d'avant la bascule, pour la rendre telle quelle en repassant a plat. */
  const pitchAvant3DRef = useRef(0);

  /**
   * Bascule 2D / 3D.
   *
   * La couche extrudee est deja peinte : il n'y aurait qu'a la montrer. Mais
   * **montrer une extrusion sur une carte a plat ne change rien a l'ecran** :
   * vues du zenith, les colonnes se confondent avec leur base. Constate au
   * navigateur le 2026-09-11 — on cliquait « Relief 3D », et il ne se passait
   * visiblement rien. Aucun test ne pouvait l'attraper : l'expression etait
   * juste, la couche visible, et la carte simplement pas inclinee.
   *
   * La bascule incline donc la camera. L'inclinaison d'avant est memorisee et
   * rendue au retour en 2D : si l'utilisateur avait deja incline la carte
   * lui-meme, on ne lui remet pas le nez sur le zenith.
   */
  const setCarreaux3D = useCallback((v: boolean) => {
    carreaux3DRef.current = v;
    _setCarreaux3D(v);
    const map = mapRef.current;
    if (!map) return;
    if (v) {
      pitchAvant3DRef.current = map.getPitch();
      if (map.getPitch() < PITCH_RELIEF) map.easeTo({ pitch: PITCH_RELIEF, duration: 600 });
    } else {
      map.easeTo({ pitch: pitchAvant3DRef.current, duration: 600 });
    }
  }, [mapRef]);

  /**
   * Exageration du relief, en multiples de la largeur de maille.
   *
   * Repose la seule expression de hauteur, sans toucher a la couleur ni aux
   * bornes : deplacer la reglette change l'exageration du relief, jamais la
   * lecture des valeurs.
   */
  const setCarreauxHauteur = useCallback((v: number) => {
    carreauxHauteurRef.current = v;
    _setCarreauxHauteur(v);
    const map = mapRef.current;
    const r = carreauxRangeRef.current;
    if (!map || !r) return;
    applyCarreauxHauteur(map, r.ind, { min: r.min, max: r.max }, v);
  }, [mapRef, applyCarreauxHauteur]);

  const setCarreauxOpacity = useCallback((v: number) => {
    carreauxOpacityRef.current = v;
    _setCarreauxOpacity(v);
    const map = mapRef.current;
    if (!map) return;
    applyBucketOpacity(map, carreauxBucketInfoRef.current, v);
  }, [mapRef, applyBucketOpacity]);

  // Sélection d'une tranche de la légende → fill-opacity expression (PAS setFilter)
  const setCarreauxSelectedBucket = useCallback((bucket: number | null) => {
    _setCarreauxSelectedBucket(bucket);
    const map = mapRef.current;
    if (!map) return;
    if (bucket === null) {
      carreauxBucketInfoRef.current = null;
      applyBucketOpacity(map, null, carreauxOpacityRef.current);
      return;
    }
    const r = carreauxRangeRef.current;
    if (!r) {
      carreauxBucketInfoRef.current = null;
      applyBucketOpacity(map, null, carreauxOpacityRef.current);
      return;
    }
    const ind = carreauxIndicateurRef.current;
    // Découpage partagé avec les deux légendes (lib/carreaux/bornes.ts) : une
    // tranche cliquée doit désigner exactement les carreaux qu'elle affiche.
    const { min, max } = palierEchelle(r, bucket, 6);
    const info = { bucket, min, max, ind };
    carreauxBucketInfoRef.current = info;
    applyBucketOpacity(map, info, carreauxOpacityRef.current);
  }, [mapRef, applyBucketOpacity]);

  // ── Coloration (indicateur + palette) ─────────────────────────────────────
  // Les bornes sont nationales et constantes : la couleur ne dépend plus de ce
  // qui est affiché. Il n'y a donc plus rien à recalculer au déplacement — les
  // abonnements `idle`/`moveend`, le débounce de 150 ms et le
  // `queryRenderedFeatures` par déplacement ont été retirés, pas neutralisés.
  // Une seule application suffit : au montage, et à tout changement
  // d'indicateur ou de palette (les dépendances de cet effet).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !carreauxVisible) return;
    if (!map.getLayer('carreaux-mvt-fill')) return;

    const bornes = bornesDe(carreauxIndicateur);
    // Garde conservée : `interpolate` à bornes non strictement croissantes est
    // rejeté EN SILENCE par MapLibre — la couche reste sans couleur, sans erreur.
    if (bornes.max <= bornes.min) return;

    // carreauxRangeRef alimente setCarreauxPalette et le filtre par palier ;
    // l'état React alimente les bornes affichées dans la légende.
    carreauxRangeRef.current = { ind: carreauxIndicateur, ...bornes };
    setCarreauxRange(bornes);
    applyCarreauxColor(map, carreauxPalette, carreauxIndicateur, bornes);
    applyCarreauxHauteur(map, carreauxIndicateur, bornes, carreauxHauteurRef.current);
  }, [carreauxIndicateur, carreauxPalette, carreauxVisible, mapReady, mapRef, applyCarreauxColor, applyCarreauxHauteur]);

  // ── IRIS — fonctions couleur + chargement ─────────────────────────────────

  /**
   * Couleur de la choroplèthe IRIS, sur l'échelle NATIONALE et NORMALISÉE.
   *
   * Trois changements, tous imposés par la cascade de `get_iris_tile` :
   *
   * 1. **Valeur normalisée.** Les paliers servent des mailles de tailles très
   *    inégales — un département somme ~475 IRIS. Sans division par la surface,
   *    la vue France serait un aplat saturé et la vue ville un aplat vide.
   * 2. **Échelle log10.** Normaliser rend les unités comparables, pas les
   *    distributions : un département moyenne ses cœurs denses avec ses
   *    campagnes, un IRIS parisien est de la densité pure. La même grandeur
   *    s'étend sur plus de 3 décades (mesuré : `population` de 25 à
   *    60 555 hab/km²). Une interpolation linéaire ne peut pas couvrir ça.
   * 3. **`step` et non `interpolate`.** Les mêmes frontières servent la peinture
   *    et la légende : l'égalité est vraie par construction, et non promise.
   *    C'est la leçon de `lib/carreaux/expressions.ts`.
   *
   * Une maille dont la donnée manque se peint en gris neutre, jamais au bas de
   * l'échelle : « on ne sait pas » n'est pas « personne ici ».
   */
  const applyIrisColor = useCallback((
    map: maplibregl.Map,
    paletteId: string,
    bornes: BornesIris,
  ) => {
    if (!map.getLayer('iris-fill')) return;
    const pal = IRIS_PALETTES.find(p => p.id === paletteId) ?? IRIS_PALETTES[0];
    const frontieres = bornesInternes(echelleDe(bornes), pal.stops.length);
    const expr = [
      'case',
      donneeIrisExploitableExpr(bornes.colonne, bornes.classe),
      ['step', echelleLogExpr(bornes), pal.stops[0],
        ...frontieres.flatMap((v, i) => [v, pal.stops[i + 1]])],
      COULEUR_DONNEE_ABSENTE,
    ] as unknown as maplibregl.ExpressionSpecification;
    try { map.setPaintProperty('iris-fill', 'fill-color', expr); } catch { /* ok */ }
    // La couche en relief porte la MEME couleur : basculer en 3D ne doit pas
    // changer la lecture, seulement l'axe sur lequel on la lit.
    try { map.setPaintProperty('iris-extrusion', 'fill-extrusion-color', expr); } catch { /* ok */ }
  }, []);

  /**
   * Hauteur des colonnes IRIS.
   *
   * Reutilise `hauteurExtrusionExpr`, la MEME expression que les carreaux :
   * l'exageration est un multiple de la largeur de maille, deduite du
   * `superficie_km2` que la tuile porte (get_iris_tile). Un relief absolu en
   * metres donnerait 0,2x de hauteur en vue large et 17x en vue rapprochee —
   * defaut mesure puis corrige sur les carreaux le meme jour.
   *
   * L'echelle vient des statistiques nationales deja chargees pour la palette :
   * hauteur et couleur disent donc exactement la meme chose.
   */
  const applyIrisHauteur = useCallback((
    map: maplibregl.Map,
    bornes: BornesIris,
    exageration: number,
  ) => {
    if (!map.getLayer('iris-extrusion')) return;
    // `hauteurExtrusionExpr` est celle des carreaux, et l'échelle passée est la
    // MÊME que celle de la couleur : hauteur et teinte disent donc exactement
    // la même chose, à tous les paliers de la cascade.
    const expr = hauteurExtrusionExpr(
      bornes.colonne,
      bornes.classe === 'effectif' ? 'superficie_km2' : bornes.colonne,
      echelleDe(bornes),
      exageration,
      echelleLogExpr(bornes),
    ) as unknown as maplibregl.ExpressionSpecification;
    try { map.setPaintProperty('iris-extrusion', 'fill-extrusion-height', expr); } catch { /* ok */ }
  }, []);

  /**
   * Bascule de la couche IRIS, qui remonte la caméra si elle est sous le
   * plancher de zoom.
   *
   * Sans ça, cocher « Couche IRIS » depuis la vue France (z5,5 au chargement)
   * ne produit RIEN : sous le minzoom d'une source, MapLibre ne demande aucune
   * tuile, n'émet aucune erreur, et la carte reste telle quelle. Le symptôme
   * est indistinguable d'une panne, et c'est ce qui a été remonté.
   *
   * On ne descend pas le plancher à la place : une tuile z8 parisienne couvre
   * 4 251 IRIS et la France entière tient en ~75 tuiles z8 — voir les mesures
   * dans `lib/version.ts`. Remonter la caméra coûte une tuile, dézoomer en
   * coûterait soixante-quinze.
   *
   * Seul le zoom bouge : le centre est conservé, l'utilisateur reste là où il
   * regardait. Et la remontée n'a lieu qu'à l'ACTIVATION — on ne contrarie
   * jamais quelqu'un qui dézoome volontairement couche allumée.
   */
  const setIrisVisible = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(irisVisibleRef.current) : v;
    irisVisibleRef.current = next;
    _setIrisVisible(next);
    if (!next) return;
    const map = mapRef.current;
    if (map && map.getZoom() < IRIS_ZOOM_PLANCHER) {
      map.easeTo({ zoom: IRIS_ZOOM_PLANCHER, duration: 800 });
    }
  }, [mapRef]);

  /** Inclinaison rendue au relief — voir setCarreaux3D pour le raisonnement. */
  const setIris3D = useCallback((v: boolean) => {
    iris3DRef.current = v;
    _setIris3D(v);
    const map = mapRef.current;
    if (!map) return;
    if (v) {
      pitchAvantIris3DRef.current = map.getPitch();
      if (map.getPitch() < 55) map.easeTo({ pitch: 55, duration: 600 });
    } else {
      map.easeTo({ pitch: pitchAvantIris3DRef.current, duration: 600 });
    }
  }, [mapRef]);

  const setIrisHauteur = useCallback((v: number) => {
    irisHauteurRef.current = v;
    _setIrisHauteur(v);
    const map = mapRef.current;
    if (!map || !irisBornes) return;
    applyIrisHauteur(map, irisBornes, v);
  }, [mapRef, irisBornes, applyIrisHauteur]);

  // Toggle choroplèthe — bascule entre couleur plate et coloration démographique
  const toggleIrisChoro = useCallback((choro: boolean) => {
    irisChoroRef.current = choro;
    setIrisChoro(choro);
    const map = mapRef.current;
    if (!map || !irisVisible) return;
    if (!choro) {
      try { map.setPaintProperty('iris-fill', 'fill-color', 'rgba(66,146,198,0.4)'); } catch { /* ok */ }
    } else if (irisBornes) {
      applyIrisColor(map, irisPaletteRef.current, irisBornes);
      applyIrisHauteur(map, irisBornes, irisHauteurRef.current);
    }
  }, [mapRef, irisVisible, irisBornes, applyIrisColor, applyIrisHauteur]);

  // Setter palette — applique couleur immédiatement si stats disponibles
  const setIrisPalette = useCallback((paletteId: string) => {
    _setIrisPalette(paletteId);
    irisPaletteRef.current = paletteId;
    const map = mapRef.current;
    if (!map || !irisBornes) return;
    applyIrisColor(map, paletteId, irisBornes);
  }, [mapRef, irisBornes, applyIrisColor]);

  const setIrisOpacity = useCallback((v: number) => {
    irisOpacityRef.current = v;
    _setIrisOpacity(v);
    const map = mapRef.current;
    if (!map) return;
    try {
      // Garde l'expression zoom-dépendante pour éviter les blobs région à bas zoom
      map.setPaintProperty('iris-fill', 'fill-opacity', v);
      map.setPaintProperty('iris-border', 'line-opacity', Math.min(v * 0.8, 0.6));
    } catch { /* ok */ }
  }, [mapRef]);

  // Zoom courant, exposé au panneau.
  //
  // Le badge de zoom de `useMapInit` est du DOM écrit à la main, hors de React :
  // le panneau n'avait donc aucun moyen de savoir à quel zoom on se trouve, et
  // une couche à plancher ne pouvait pas expliquer son absence.
  //
  // `zoomend` et non `zoom` : un re-render par geste, pas un par frame.
  const [zoomCourant, setZoomCourant] = useState<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const releve = () => setZoomCourant(map.getZoom());
    releve();
    map.on('zoomend', releve);
    return () => { map.off('zoomend', releve); };
  }, [mapReady, mapRef]);

  // Visibilité IRIS — plat et relief ne coexistent JAMAIS (géométries
  // coplanaires à la base : z-fighting sur la face supérieure, même contrainte
  // que les carreaux).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const plat   = irisVisible && !iris3D ? 'visible' : 'none';
    const relief = irisVisible &&  iris3D ? 'visible' : 'none';
    try {
      map.setLayoutProperty('iris-fill',      'visibility', plat);
      map.setLayoutProperty('iris-border',    'visibility', plat);
      map.setLayoutProperty('iris-extrusion', 'visibility', relief);
    } catch { /* ok */ }
  }, [irisVisible, iris3D, mapReady, mapRef]);

  // Filtre IRIS — vrais IRIS uniquement vs tous (toggle irisTrueOnly)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // `is_true_iris` n'existe QU'AU palier IRIS de la cascade : un département
    // ou une commune agrégée n'a pas de drapeau « vrai IRIS ». Filtrer dessus
    // sans condition viderait la carte dès qu'on s'éloigne — MVT omet une
    // propriété absente, `['get']` rend `null`, et `null != true`.
    const filter = irisTrueOnly
      ? ['any',
          ['!=', ['get', 'niveau'], 'iris'],
          ['==', ['get', 'is_true_iris'], true],
        ] as maplibregl.ExpressionSpecification
      : null;
    try {
      map.setFilter('iris-fill',      filter);
      map.setFilter('iris-border',    filter);
      map.setFilter('iris-extrusion', filter);
    } catch { /* ok — layer non disponible */ }
  }, [irisTrueOnly, mapReady, mapRef]);

  // Chargement IRIS — les tiles MVT sont gérées automatiquement par MapLibre.
  // On charge les stats globales (France entière) une seule fois pour calibrer la palette.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!irisVisible) return;   // la visibilité est pilotée par l'effet ci-dessus

    // Opacité seulement : la visibilité des couches (plat contre relief) est
    // décidée par l'effet précédent, qui connaît l'état 3D. La repositionner
    // ici rallumerait le plat par-dessus le relief.
    try {
      map.setPaintProperty('iris-fill', 'fill-opacity', irisOpacityRef.current);
    } catch { /* ok */ }

    // Mode contours seuls : couleur plate, pas de chargement stats
    if (!irisChoroRef.current) {
      try {
        map.setPaintProperty('iris-fill', 'fill-color', 'rgba(66,146,198,0.4)');
      } catch { /* ok */ }
      return;
    }

    // Mode choroplèthe : calibrer la palette sur les bornes NATIONALES.
    //
    // Avant, cette branche appelait `/api/iris/stats` par colonne consultée, et
    // chaque appel faisait un `percentile_cont` sur les 49 448 IRIS — un
    // balayage complet de la table à chaque changement d'indicateur. Les bornes
    // sont désormais matérialisées (`iris_bornes_echelle`, sql/140) et servies
    // en UNE fois pour toutes les colonnes : un aller-retour de ~4 kB par
    // session au lieu d'un full scan par indicateur.
    const col = irisIndicateurRef.current;

    const appliquer = (catalogue: CatalogueBornesIris) => {
      const bornes = catalogue[col] ?? null;
      setIrisBornes(bornes);
      // Pas de bornes = colonne absente OU entièrement vide en base. Les deux
      // se valent pour l'utilisateur : il n'y a rien à colorer. Quatre colonnes
      // proposées par le panneau sont dans ce cas (mesuré le 2026-09-12).
      if (!bornes) return;
      applyIrisColor(map, irisPaletteRef.current, bornes);
      applyIrisHauteur(map, bornes, irisHauteurRef.current);
    };

    if (irisBornesCacheRef.current) {
      appliquer(irisBornesCacheRef.current);
      return;
    }

    fetch('/api/iris/bornes')
      .then(r => r.ok ? r.json() as Promise<CatalogueBornesIris> : null)
      .then(catalogue => {
        if (!catalogue) return;
        irisBornesCacheRef.current = catalogue;
        appliquer(catalogue);
      })
      .catch(() => {});
  }, [irisVisible, irisIndicateur, irisChoro, mapReady, mapRef, applyIrisColor, applyIrisHauteur]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Visualization functions ───────────────────────────────────────────────

  // Référence interne pour accumuler les anneaux partiels côté client
  const partialRingsRef = useRef<GeoJSON.Feature[]>([]);

  /**
   * Réinitialise les anneaux partiels — à appeler au début de chaque nouvelle bataille.
   */
  const clearBattlePartialRings = () => {
    partialRingsRef.current = [];
    const map = mapRef.current;
    if (!map) return;
    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (ringSrc) ringSrc.setData({ type: 'FeatureCollection', features: [] });
  };

  /**
   * Ajoute des anneaux bruts ORS sur la carte dès qu'ils arrivent (avant ST_Difference).
   * Ces polygones se chevauchent — ils sont remplacés par le résultat final de applyIsochroneBattle.
   */
  const addBattlePartialRings = (
    rawRings: { cirfa_id: string; nom: string; lat: number; lng: number; palier: number; geojson: object }[]
  ) => {
    const map = mapRef.current;
    if (!map) return;

    // Reconstruire la map poi_id → couleur depuis les rings déjà accumulés
    const poiColorMap = new Map<string, string>();
    let colorIdx = 0;
    for (const f of partialRingsRef.current) {
      const cid = String(f.properties?.cirfa_id ?? f.properties?.id ?? '');
      if (cid && !poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[colorIdx % VORONOI_PALETTE.length]);
        colorIdx++;
      }
    }

    for (const r of rawRings) {
      const cid = r.cirfa_id;
      if (!poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[colorIdx % VORONOI_PALETTE.length]);
        colorIdx++;
      }

      const feat: GeoJSON.Feature = {
        type:       'Feature',
        geometry:   r.geojson as GeoJSON.Geometry,
        properties: {
          id:             cid,
          cirfa_id:       cid,
          nom:            r.nom,
          lat:            r.lat,
          lng:            r.lng,
          palier:         r.palier,
          battle_color:   poiColorMap.get(cid)!,
          battle_opacity: (BATTLE_PALIER_OPACITY as Record<number, number>)[r.palier] ?? 0.15,
          _partial:       true,
        },
      };
      partialRingsRef.current.push(feat);
    }

    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    if (ringSrc) {
      ringSrc.setData({ type: 'FeatureCollection', features: partialRingsRef.current } as GeoJSON.FeatureCollection);
      try {
        map.setLayoutProperty('battle-fill',      'visibility', 'visible');
        map.setLayoutProperty('battle-ring-line', 'visibility', 'visible');
      } catch { /* layer pas encore prêt */ }
      setBattleVisible(true);
    }
  };

  const applyIsochroneBattle = (
    ringData:   { type: string; features: GeoJSON.Feature[] },
    borderData: { type: string; features: GeoJSON.Feature[] } | null | undefined,
    category?:  string,
    poisForMap?: { id: string; nom: string; lat: number; lng: number; adresse?: string; ville?: string }[]
  ) => {
    const map = mapRef.current;
    logger.debug('applyIsochroneBattle', `called — map ${!!map} | features: ${ringData?.features?.length}`);
    if (!map) return;

    const poiColorMap = new Map<string, string>();
    let _colorIdx = 0;
    for (const f of ringData.features) {
      const p   = f.properties as Record<string, unknown>;
      // Support: 'id' (v2) ou 'cirfa_id' (v1 éventuelle)
      const cid = String(p?.id ?? p?.cirfa_id ?? '');
      if (cid && !poiColorMap.has(cid)) {
        poiColorMap.set(cid, VORONOI_PALETTE[_colorIdx % VORONOI_PALETTE.length]);
        _colorIdx++;
      }
    }

    const styledRings = ringData.features.map((f) => {
      const p      = f.properties as Record<string, unknown>;
      const cid    = String(p?.id ?? p?.cirfa_id ?? '');
      const palier = Number(p?.palier ?? 120);
      return {
        ...f,
        properties: {
          ...p,
          battle_color:   poiColorMap.get(cid) ?? VORONOI_PALETTE[0],
          battle_opacity: (BATTLE_PALIER_OPACITY as Record<number, number>)[palier] ?? 0.20,
        },
      };
    });

    // Vider les anneaux partiels — le résultat final les remplace
    partialRingsRef.current = [];

    const ringSrc = map.getSource('battle-rings') as maplibregl.GeoJSONSource | undefined;
    logger.debug('applyIsochroneBattle', `ringSrc ${!!ringSrc} | styledRings: ${styledRings.length}`);
    if (!ringSrc) return;
    ringSrc.setData({ type: 'FeatureCollection', features: styledRings } as GeoJSON.FeatureCollection);
    map.triggerRepaint();

    const borderSrc = map.getSource('battle-borders') as maplibregl.GeoJSONSource | undefined;
    if (borderSrc && borderData?.features?.length) {
      borderSrc.setData(borderData as unknown as GeoJSON.FeatureCollection);
      try { map.setLayoutProperty('battle-cirfa-border', 'visibility', 'visible'); } catch {}
    }

    try {
      map.setLayoutProperty('battle-fill',      'visibility', 'visible');
      map.setLayoutProperty('battle-ring-line', 'visibility', 'visible');
    } catch {}
    setBattleVisible(true);
    setBattleCategory(category ?? '');

    // Utiliser poisForMap (tous les POIs) si disponible,
    // sinon extraire des ring features (peut rater des POIs sans territoire).
    const poiFeatures: GeoJSON.Feature[] = [];
    if (poisForMap && poisForMap.length > 0) {
      for (const p of poisForMap) {
        if (!isNaN(p.lat) && !isNaN(p.lng) && p.lat && p.lng) {
          poiFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { nom: p.nom, adresse: p.adresse ?? '', ville: p.ville ?? '', id: p.id },
          });
        }
      }
    } else {
      const poisSeen = new Set<string>();
      for (const f of ringData.features) {
        const p = f.properties as Record<string, unknown>;
        const pid  = String(p.id ?? p.cirfa_id ?? '');
        const plat = Number(p.lat);
        const plng = Number(p.lng);
        if (pid && !poisSeen.has(pid) && !isNaN(plat) && !isNaN(plng) && plat && plng) {
          poisSeen.add(pid);
          poiFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [plng, plat] },
            properties: { nom: p.nom, adresse: p.adresse, ville: p.ville, id: pid },
          });
        }
      }
    }
    const poisSrc = map.getSource('battle-pois') as maplibregl.GeoJSONSource | undefined;
    if (poisSrc && poiFeatures.length > 0) {
      poisSrc.setData({ type: 'FeatureCollection', features: poiFeatures });
      try {
        map.setLayoutProperty('battle-pois-halo',   'visibility', 'visible');
        map.setLayoutProperty('battle-pois-circle', 'visibility', 'visible');
      } catch {}
    }

    const _seen = new Set<string>();
    const legend: { id: string; nom: string; color: string }[] = [];
    for (const f of styledRings) {
      const p = f.properties as Record<string, unknown>;
      const cid = String(p?.id ?? '');
      if (cid && !_seen.has(cid)) {
        _seen.add(cid);
        legend.push({ id: cid, nom: String(p?.nom ?? cid), color: poiColorMap.get(cid) ?? VORONOI_PALETTE[0] });
      }
    }
    setBattlePois(legend);

    if (styledRings.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      let extended = false;
      for (const f of styledRings) {
        const geom = (f as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>).geometry;
        if (!geom) continue;
        const coordRings = geom.type === 'MultiPolygon'
          ? geom.coordinates.flat(1)
          : geom.type === 'Polygon' ? geom.coordinates : [];
        for (const ring of coordRings) {
          for (const coord of ring) {
            bounds.extend([coord[0], coord[1]]);
            extended = true;
          }
        }
      }
      if (extended) {
        logger.debug('applyIsochroneBattle', 'fitBounds called');
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1200 });
      }
    }
  };

  const applyIsochrones = (isoData: IsochroneData) => {
    const map = mapRef.current;
    if (!map) return;

    const mode   = isoData._meta?.mode ?? 'walk';
    const colors = ISOCHRONE_COLORS[mode] ?? ISOCHRONE_COLORS.walk;

    const source = map.getSource('isochrones') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(isoData as unknown as GeoJSON.FeatureCollection);
    map.setPaintProperty('isochrones-fill', 'fill-color', colors.fill);
    map.setPaintProperty('isochrones-line', 'line-color', colors.line);
    map.setLayoutProperty('isochrones-fill', 'visibility', 'visible');
    map.setLayoutProperty('isochrones-line', 'visibility', 'visible');

    setIsochroneMode(mode);
    setIsochroneMinutes(isoData._meta?.minutes ?? 0);
    setIsochroneFromCache(isoData._fromCache ?? false);
    setIsochroneCachedAt(isoData._cachedAt ?? '');
    setIsochroneVisible(true);

    lastIsochroneDataRef.current = isoData;
  };

  const loadCarreauxFromAI = async (cd: CarreauxData) => {
    const map = mapRef.current;
    if (!map) return;

    const { lat, lng } = cd.coordonnees;
    // Fly to z12 pour vue détaillée 200m (carreaux visibles dès z6)
    map.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });

    setCarreauxVisible(true);
    setCarreauxIndicateur(cd.indicateur);
    setCarreauxLabel(cd.indicateur_label);
  };

  const runTestIsochrone = async (
    region   = 'Bretagne',
    category = 'cirfa',
    minutes  = 10,
    mode     = 'drive'
  ) => {
    const map = mapRef.current;
    if (!map || testIsoLoading) return;

    setTestIsoLoading(true);
    setTestIsoDebug('Appel ORS en cours…');

    try {
      const url = `/api/test-isochrone?region=${encodeURIComponent(region)}&category=${encodeURIComponent(category)}&minutes=${minutes}&mode=${mode}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.error) {
        setTestIsoDebug(`❌ ${data.error ?? 'Erreur inconnue'}`);
        return;
      }

      const src = map.getSource('test-iso') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data as GeoJSON.FeatureCollection);
        setTestIsoVisible(true);
      }

      const d = data._debug;
      setTestIsoDebug(
        `${d?.message ?? '?'} | ${d?.tested_count ?? '?'} CIRFAs testés / ${d?.poi_count ?? '?'} trouvés`
      );

      if (data.features?.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        let extended = false;
        for (const f of data.features) {
          const geom = f.geometry;
          if (!geom) continue;
          const rings = geom.type === 'MultiPolygon'
            ? geom.coordinates.flat(1)
            : geom.type === 'Polygon' ? geom.coordinates : [];
          for (const ring of rings) {
            for (const coord of ring) {
              bounds.extend([coord[0], coord[1]]);
              extended = true;
            }
          }
        }
        if (extended) map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 900 });
      }
    } catch (e: unknown) {
      setTestIsoDebug(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestIsoLoading(false);
    }
  };

  // ── Dégradé de couleur actif (Tâche 6) — un seul à la fois, cf lib/carte/degrades.ts.
  // Carreaux et IRIS vivent ici : leur extinction (quand un autre dégradé
  // s'active) est donc appliquée directement. Les trois autres dégradés
  // (indicateurs civiques, santé environnementale, météo, impressions de
  // campagne) sont pilotés par app/map/page.tsx — `basculerDegrade` rend
  // `aEteindre` pour que la page applique leur propre extinction + le toast.
  const [degradeActif, setDegradeActif] = useState<DegradeId | null>(null);
  const basculerDegrade = useCallback((cible: DegradeId, next: boolean): DegradeId | null => {
    const resultat = basculerDegradePur(degradeActif, cible, next);
    setDegradeActif(resultat.degradeActif);
    if (resultat.aEteindre === 'carreaux') setCarreauxVisible(false);
    if (resultat.aEteindre === 'iris') setIrisVisible(false);
    return resultat.aEteindre;
  }, [degradeActif, setCarreauxVisible, setIrisVisible]);

  return {
    // Bataille
    battleVisible, setBattleVisible,
    battleCategory,
    battlePois,
    battleOuterFillVisible, setBattleOuterFillVisible,
    battleMaxPalier, setBattleMaxPalier,
    // Test ORS
    testIsoVisible,
    testIsoLoading,
    testIsoDebug,
    // Isochrones
    isochroneVisible, setIsochroneVisible,
    isochroneMode,
    isochroneMinutes,
    isochroneFromCache, setIsochroneFromCache,
    isochroneCachedAt,
    lastIsochroneDataRef,
    // Carreaux
    carreauxVisible, setCarreauxVisible,
    carreauxLoaded,
    carreauxIndicateur, setCarreauxIndicateur,
    carreauxPalette,    setCarreauxPalette,
    carreauxOpacity,    setCarreauxOpacity,
    carreaux3D,         setCarreaux3D,
    carreauxHauteur,    setCarreauxHauteur,
    carreauxRange,
    carreauxSelectedBucket, setCarreauxSelectedBucket,
    carreauxLabel,
    carreauxSourcesRef,
    // IRIS
    irisVisible,    setIrisVisible,
    irisChoro,      toggleIrisChoro,
    irisIndicateur, setIrisIndicateur,
    irisPalette,    setIrisPalette,
    irisOpacity,    setIrisOpacity,
    iris3D,         setIris3D,
    irisHauteur,    setIrisHauteur,
    irisBornes,
    irisTrueOnly,   setIrisTrueOnly,
    // Zoom courant + plancher des IRIS : de quoi dire au panneau pourquoi la
    // couche ne montre rien, au lieu de laisser une carte vide muette.
    zoomCourant,
    irisZoomPlancher: IRIS_ZOOM_PLANCHER,
    // Dégradé de couleur actif (Tâche 6, exclusivité — lib/carte/degrades.ts)
    degradeActif,
    setDegradeActif,
    basculerDegrade,
    // Visualization functions
    clearBattlePartialRings,
    addBattlePartialRings,
    applyIsochroneBattle,
    applyIsochrones,
    loadCarreauxFromAI,
    runTestIsochrone,
  };
}

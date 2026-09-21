'use client';

/**
 * Carte de France du module « population à risque ».
 *
 * ── POURQUOI DU SVG ET PAS MAPLIBRE ───────────────────────────────────────
 *
 * Il n'y a rien à naviguer. Pas de zoom, pas de fond de carte, pas de tuiles :
 * une vue fixe, 104 départements ou 18 régions, qui réagit au même jeu de
 * données que le tableau. Monter une instance MapLibre coûterait un canvas
 * WebGL, un style à charger et un cycle de vie à gérer, pour un résultat moins
 * net qu'un tracé vectoriel.
 *
 * Conséquence voulue : **cette carte n'entre PAS au registre des dégradés**
 * (`lib/carte/degrades.ts`). Ce registre garantit qu'une seule choroplèthe
 * s'affiche à la fois sur la carte PRINCIPALE ; l'y inscrire éteindrait le
 * calque que l'utilisateur regardait derrière l'overlay.
 *
 * ── TROIS DÉCISIONS DE CARTOGRAPHIE ───────────────────────────────────────
 *
 * **1. Seuils naturels, pas quantiles** (`lib/carte/seuils-naturels.ts`). Les
 * quantiles imposent le même effectif par classe ; sur une grandeur aussi
 * concentrée que l'exposition au risque — les 10 premiers départements portent
 * 54 % du total — ils peignent de la même couleur un département à 0,8 % et la
 * Seine-Maritime à 4,07 %. Jenks cherche les creux réels de la distribution.
 *
 * **2. Un EFFECTIF ne se peint pas en aplat.** Colorier « 14 205 habitants »
 * sur le Nord et sur le Val-de-Marne, qui n'ont ni la même surface ni la même
 * population, c'est la faute classique de la choroplèthe : l'œil lit la
 * surface, donc les grands départements paraissent toujours plus atteints. Un
 * effectif se représente en **cercles proportionnels**, dont l'AIRE — jamais le
 * rayon — suit la valeur. Part et densité, elles, sont des rapports : l'aplat
 * leur convient.
 *
 * **3. Les territoires lointains ont leurs cartouches.** Chaque cartouche
 * DÉRIVE son cadrage de la géométrie reçue, sans aucune coordonnée écrite en
 * dur — un redécoupage n'a donc rien à casser.
 *
 * Deux cartouches peuvent désormais s'afficher pour de bon : les carreaux de
 * **la Martinique et de La Réunion** sont en base depuis le 2026-09-18
 * (`scripts/local/07-carreaux-insee.sh` — 11 222 et 14 773 carreaux,
 * 1 190 910 habitants à eux deux). L'INSEE les publie dans le même fichier que
 * la métropole ; c'est notre import qui s'était arrêté à l'Hexagone.
 *
 * ⚠ La Guadeloupe, la Guyane et Mayotte n'auront JAMAIS de cartouche tant que
 * la source n'aura pas changé : l'INSEE ne carroye pas ces trois territoires.
 * Leurs 603 sites, dont 31 Seveso — les 27 de Guyane compris — n'ont aucune
 * population exposée calculable. L'absence de cartouche y est une donnée
 * manquante à la source, jamais une exposition nulle : le gris de la carte dit
 * « zéro exposé », et il ne faut pas le leur appliquer.
 */
import React, { useMemo, useState } from 'react';
import { formaterNombre } from '@/lib/format/nombre';
import { seuilsNaturels, classeDe } from '@/lib/carte/seuils-naturels';
import { fInter, fMono } from '@/lib/design/polices';

/**
 * Une géométrie GeoJSON telle que `get_zone_polygons` la rend.
 *
 * ⚠ `GeometryCollection` n'est PAS un cas exotique : **66 des 104
 * départements** en sont une (mesuré en production le 2026-09-18), dont Paris,
 * le Rhône, les Bouches-du-Rhône et le Nord. Une collection ne porte pas de
 * `coordinates` mais un tableau `geometries` — l'ignorer ne lève rien, elle
 * disparaît simplement du tracé, et un département non dessiné laisse voir le
 * fond de page, donc du BLANC, indiscernable d'une unité sans donnée.
 */
type GeometrieZone =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'GeometryCollection'; geometries: GeometrieZone[] };

export interface ZoneGeo {
  type: 'Feature';
  properties: { code: string; nom: string };
  geometry: GeometrieZone;
}

interface Boite { x: number; y: number; w: number; h: number }

interface Props {
  zones: ZoneGeo[];
  /** Valeur à représenter, par code d'unité. Absente = unité non exposée. */
  valeurs: Map<string, number>;
  /** Ce que la valeur encode — sert la légende et l'infobulle. */
  libelleValeur: string;
  formater?: (v: number) => string;
  /**
   * Les couleurs, du plus faible au plus fort, fournies par l'appelant : c'est
   * le catalogue déjà utilisé par les carreaux et les IRIS, et l'utilisateur
   * choisit.
   */
  stops: string[];
  /**
   * `aplat` pour un RAPPORT (part, densité), `cercles` pour un EFFECTIF.
   * Voir la décision 2 de l'en-tête — ce n'est pas un goût, c'est ce qui
   * empêche la carte de mentir.
   */
  mode?: 'aplat' | 'cercles';
  codeActif?: string | null;
  /**
   * L'unité sur laquelle CADRER, ou `null` pour la France entière.
   *
   * ⚠ Distincte de `codeActif`, qui est le SURVOL : l'un suit la souris et
   * s'efface, l'autre tient jusqu'au clic suivant. Cadrer sur le survol ferait
   * sauter la carte au moindre mouvement au-dessus du tableau.
   */
  cadrageSur?: string | null;
  onSurvol?: (code: string | null) => void;
  onClic?: (code: string) => void;
}

const LARGEUR = 300;
const HAUTEUR = 300;
/** Cinq classes : au-delà, l'œil ne distingue plus deux paliers voisins. */
const N_CLASSES = 5;
/** Côté d'un cartouche d'outre-mer, en unités du viewBox. */
const COTE_OM = 30;


/**
 * Mercator sphérique — même projection que la carte principale.
 *
 * ⚠ LES DEUX AXES DOIVENT ÊTRE DANS LA MÊME UNITÉ, et c'est le piège qui a
 * aplati la carte.
 *
 * `mercatorX` renvoie des RADIANS, pas des degrés. La formule de Mercator
 * donne `y = ln(tan(π/4 + φ/2))`, un nombre sans dimension de l'ordre de 1 —
 * la France métropolitaine y couvre 0,245. En longitude, elle couvre 14,7
 * DEGRÉS. Comparer les deux pour calculer une échelle commune revient à
 * comparer des kilomètres à des pouces : l'échelle est alors imposée par la
 * longitude, et la hauteur utile tombe à **5 pixels sur 258** — un trait
 * horizontal, ce qui est exactement ce qui s'affichait.
 *
 * En radians, la France couvre 0,257 en x et 0,245 en y : le rapport vaut 1,05,
 * et la silhouette est juste.
 */
function mercatorX(lon: number): number {
  return (lon * Math.PI) / 180;
}

function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
}

interface Cadre { ouest: number; est: number; sud: number; nord: number }

/**
 * Projette un cadre géographique dans une boîte de dessin en CONSERVANT les
 * proportions. Sans cela, la Guyane (large) et La Réunion (ronde) seraient
 * étirées différemment dans des cartouches de même taille, et une île y
 * paraîtrait plus grande qu'elle n'est.
 */
function projecteur(cadre: Cadre, boite: Boite) {
  // Les DEUX axes en radians de Mercator : voir l'avertissement ci-dessus.
  const xOuest = mercatorX(cadre.ouest);
  const xEst = mercatorX(cadre.est);
  const ySud = mercatorY(cadre.sud);
  const yNord = mercatorY(cadre.nord);
  const dX = xEst - xOuest || 1e-9;
  const dY = yNord - ySud || 1e-9;
  const echelle = Math.min(boite.w / dX, boite.h / dY);
  const largeurUtile = dX * echelle;
  const hauteurUtile = dY * echelle;
  const dx = boite.x + (boite.w - largeurUtile) / 2;
  const dy = boite.y + (boite.h - hauteurUtile) / 2;
  return (lon: number, lat: number): [number, number] => [
    dx + (mercatorX(lon) - xOuest) * echelle,
    dy + hauteurUtile - (mercatorY(lat) - ySud) * echelle,
  ];
}

/** Tous les anneaux d'une géométrie, collections comprises. */
function anneaux(g: GeometrieZone | null | undefined): number[][][] {
  if (!g) return [];
  if (g.type === 'GeometryCollection') {
    return Array.isArray(g.geometries) ? g.geometries.flatMap(anneaux) : [];
  }
  if (!Array.isArray(g.coordinates)) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!Array.isArray(polys)) return [];
  const out: number[][][] = [];
  for (const p of polys) {
    if (!Array.isArray(p)) continue;
    for (const a of p) if (Array.isArray(a) && a.length >= 3) out.push(a);
  }
  return out;
}

/** Cadre englobant d'un lot de zones. `null` si aucune géométrie exploitable. */
function cadreDe(zones: ZoneGeo[]): Cadre | null {
  let ouest = Infinity, est = -Infinity, sud = Infinity, nord = -Infinity;
  for (const z of zones) {
    for (const a of anneaux(z.geometry)) {
      for (const paire of a) {
        const lon = paire[0], lat = paire[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        if (lon < ouest) ouest = lon;
        if (lon > est) est = lon;
        if (lat < sud) sud = lat;
        if (lat > nord) nord = lat;
      }
    }
  }
  return Number.isFinite(ouest) ? { ouest, est, sud, nord } : null;
}

/**
 * Élargit un cadre d'une marge relative — le `padding` d'un `fitBounds`.
 *
 * ⚠ La marge est proportionnelle à chaque côté, et un PLANCHER en degrés la
 * complète : sans lui, une unité minuscule — une commune de quelques
 * centaines de mètres — donnerait un cadre presque nul, donc un facteur
 * d'échelle immense et un tracé qui déborde de tous les côtés.
 *
 * @param c - Le cadre à élargir.
 * @param part - La marge, en fraction de l'étendue (0,15 = 15 %).
 * @returns Un cadre élargi.
 */
function elargir(c: Cadre, part: number): Cadre {
  const mx = Math.max((c.est - c.ouest) * part, 0.05);
  const my = Math.max((c.nord - c.sud) * part, 0.05);
  return { ouest: c.ouest - mx, est: c.est + mx, sud: c.sud - my, nord: c.nord + my };
}

function chemin(z: ZoneGeo, proj: (lon: number, lat: number) => [number, number]): string {
  const morceaux: string[] = [];
  for (const a of anneaux(z.geometry)) {
    const pts = a.map((p) => proj(p[0], p[1]));
    morceaux.push(`M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`);
  }
  return morceaux.join('');
}

/** Centre du cadre englobant — suffisant pour poser un cercle sur une vignette. */
function centreDe(z: ZoneGeo, proj: (lon: number, lat: number) => [number, number]): [number, number] | null {
  const c = cadreDe([z]);
  if (!c) return null;
  return proj((c.ouest + c.est) / 2, (c.sud + c.nord) / 2);
}

/**
 * Sépare la métropole des territoires lointains — par la GÉOGRAPHIE, pas par
 * le code.
 *
 * ── LE DÉFAUT QUE CETTE FONCTION CORRIGE ──────────────────────────────────
 *
 * La première version testait `/^97\d$/`, la règle INSEE des DÉPARTEMENTS
 * d'outre-mer. Elle marchait à la maille département — et cassait
 * complètement la carte à la maille RÉGION, où les mêmes territoires portent
 * les codes **01, 02, 03, 04 et 06** (Guadeloupe, Martinique, Guyane, La
 * Réunion, Mayotte), indiscernables de codes métropolitains.
 *
 * Conséquence mesurée à l'écran : ces régions entraient dans le cadre
 * principal, dont l'étendue passait de 15° de longitude à plus de 110° — de la
 * Guyane à La Réunion. La France métropolitaine se réduisait alors à quelques
 * pixels au centre d'un cadre vide.
 *
 * ── LA RÈGLE RETENUE ──────────────────────────────────────────────────────
 *
 * On prend la MÉDIANE des centres, puis on écarte ce qui s'en éloigne de plus
 * de `ECART_LOINTAIN` degrés. La médiane est insensible aux valeurs extrêmes —
 * c'est justement ce qu'on veut quand les extrêmes sont ce qu'on cherche à
 * isoler.
 *
 * Aucun code ni aucune coordonnée n'est écrit en dur : la règle tient à
 * n'importe quelle maille, y compris une nomenclature qu'on ne connaît pas
 * encore. Le seuil est un ORDRE DE GRANDEUR, pas une frontière — la métropole
 * tient dans 15° de longitude et 10° de latitude, les territoires ultramarins
 * sont à plus de 40° du centre.
 */
const ECART_LOINTAIN = 20;

function mediane(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

function separerLointains(zones: ZoneGeo[]): { principal: ZoneGeo[]; lointains: ZoneGeo[] } {
  const centres = new Map<string, [number, number]>();
  for (const z of zones) {
    const c = cadreDe([z]);
    if (c) centres.set(z.properties.code, [(c.ouest + c.est) / 2, (c.sud + c.nord) / 2]);
  }
  const vals = [...centres.values()];
  if (vals.length === 0) return { principal: zones, lointains: [] };
  const mLon = mediane(vals.map((v) => v[0]));
  const mLat = mediane(vals.map((v) => v[1]));

  const principal: ZoneGeo[] = [];
  const lointains: ZoneGeo[] = [];
  for (const z of zones) {
    const c = centres.get(z.properties.code);
    const loin = c !== undefined
      && (Math.abs(c[0] - mLon) > ECART_LOINTAIN || Math.abs(c[1] - mLat) > ECART_LOINTAIN);
    (loin ? lointains : principal).push(z);
  }
  return { principal, lointains };
}

interface Trace { code: string; nom: string; d: string; c: [number, number] | null }
interface TraceOM extends Trace { boite: Boite }

export function CarteMiniFrance({
  zones, valeurs, libelleValeur, formater = formaterNombre,
  stops, mode = 'aplat', codeActif, cadrageSur, onSurvol, onClic,
}: Props) {
  /**
   * On ÉCARTE le premier palier de la rampe.
   *
   * Les palettes séquentielles du catalogue (rouge, bleu, vert, violet) sont
   * conçues pour un fond blanc : leur extrémité basse est quasi blanche
   * (#FFF5F0 pour la rouge). Un département peint de cette teinte est
   * indiscernable du fond, donc d'un département NON DESSINÉ — exactement la
   * confusion qui a fait chercher des sites manquants alors que 66
   * départements n'étaient pas tracés.
   */
  const rampe = useMemo(() => (stops.length > 2 ? stops.slice(1) : stops), [stops]);
  const [survole, setSurvole] = useState<string | null>(null);

  const { principal: metropole, lointains } = useMemo(() => separerLointains(zones), [zones]);
  // Seuls les territoires lointains EXPOSÉS reçoivent un cartouche : en
  // afficher onze dont neuf vides encombrerait la carte sans rien apprendre.
  const outreMer = useMemo(
    () => lointains.filter((z) => valeurs.has(z.properties.code)),
    [lointains, valeurs],
  );

  const bornes = useMemo(
    () => seuilsNaturels([...valeurs.values()], Math.min(N_CLASSES, rampe.length)),
    [valeurs, rampe.length],
  );

  const couleur = (code: string): string => {
    const c = classeDe(valeurs.get(code), bornes);
    return c < 0 ? 'var(--donnee-absente)' : rampe[Math.min(c, rampe.length - 1)];
  };

  /**
   * Rayon d'un cercle proportionnel : l'AIRE suit la valeur, donc le rayon suit
   * sa racine carrée. S'en écarter (rayon proportionnel à la valeur) exagère
   * les grandes valeurs d'un facteur égal au rapport lui-même — une unité 100
   * fois plus exposée occuperait 10 000 fois la surface.
   */
  const maxValeur = useMemo(() => {
    const v = [...valeurs.values()].filter((x) => Number.isFinite(x) && x > 0);
    return v.length > 0 ? Math.max(...v) : 1;
  }, [valeurs]);
  const rayon = (v: number) => 2 + Math.sqrt(v / maxValeur) * 15;

  /**
   * Le cadre de la métropole — ou celui de l'unité SÉLECTIONNÉE.
   *
   * ── LE RECADRAGE, VERSION SVG ─────────────────────────────────────────
   *
   * C'est le `fitBounds` que demande le brief, traduit dans le seul langage
   * de cette carte : elle n'a ni tuiles ni caméra, seulement une projection.
   * Changer le cadre projeté REVIENT à cadrer dessus, et coûte un rendu — pas
   * une instance WebGL de plus.
   *
   * ⚠ Le repli sur la France entière n'est pas un détail : une unité peut
   * être sélectionnée dans le TABLEAU sans exister dans les géométries
   * affichées — après une descente, la sélection appartient au niveau qu'on
   * vient de quitter. Cadrer sur rien laisserait un écran vide.
   */
  const cadreMetro = useMemo(() => {
    if (cadrageSur) {
      const z = metropole.find((x) => x.properties.code === cadrageSur);
      const c = z ? cadreDe([z]) : null;
      if (c) return elargir(c, 0.18);
    }
    return cadreDe(metropole);
  }, [metropole, cadrageSur]);
  const projMetro = useMemo(
    () => (cadreMetro ? projecteur(cadreMetro, { x: 0, y: 0, w: LARGEUR, h: HAUTEUR - 42 }) : null),
    [cadreMetro],
  );

  const tracesMetro: Trace[] = useMemo(() => {
    if (!projMetro) return [];
    return metropole.map((z) => ({
      code: z.properties.code,
      nom: z.properties.nom,
      d: chemin(z, projMetro),
      c: centreDe(z, projMetro),
    }));
  }, [metropole, projMetro]);

  /** Une bande de cartouches sous la métropole, un par territoire exposé. */
  const tracesOM: TraceOM[] = useMemo(() => {
    const out: TraceOM[] = [];
    outreMer.forEach((z, i) => {
      const boite: Boite = { x: 3 + i * (COTE_OM + 5), y: HAUTEUR - COTE_OM - 10, w: COTE_OM, h: COTE_OM };
      const c = cadreDe([z]);
      if (!c) return;
      const proj = projecteur(c, boite);
      out.push({
        code: z.properties.code, nom: z.properties.nom,
        d: chemin(z, proj), boite,
        c: [boite.x + boite.w / 2, boite.y + boite.h / 2],
      });
    });
    return out;
  }, [outreMer]);

  /**
   * L'unité mise en avant : survol, puis survol du tableau, puis CADRAGE.
   *
   * ⚠ `cadrageSur` a été ajouté à cette cascade après vérification à l'écran :
   * la carte se recadrait bien — Val-d'Oise mesuré au centre exact de la boîte
   * — mais **rien ne disait sur quoi**. L'unité cadrée était tracée comme ses
   * voisines, et avec les départements limitrophes qui débordent du cadre, on
   * ne pouvait pas distinguer le sujet du décor.
   *
   * L'ordre compte : un survol en cours l'emporte sur le cadrage, parce qu'il
   * répond à un geste en train de se faire.
   */
  const enAvant = survole ?? codeActif ?? cadrageSur ?? null;
  const nomActif = [...tracesMetro, ...tracesOM].find((t) => t.code === enAvant)?.nom ?? enAvant;
  const valeurActive = enAvant ? valeurs.get(enAvant) : undefined;

  const traits = (code: string) => ({
    stroke: enAvant === code ? 'var(--brand-teal)' : 'var(--text-tertiary)',
    strokeWidth: enAvant === code ? 1.6 : 0.7,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        role="img"
        aria-label={`Carte de France — ${libelleValeur}`}
        /*
         * ⚠ `maxHeight` en unités de VIEWPORT, et `height: auto` conservé.
         *
         * La carte est carrée (300 × 300) et prenait donc toute la largeur du
         * panneau en hauteur : à 480 px de panneau, elle dépassait le bas de
         * l'écran et il fallait faire défiler pour la voir entière — alors
         * qu'elle sert justement à voir d'un coup d'œil. Le plafond la borne
         * sans la déformer : `preserveAspectRatio` vaut `xMidYMid meet` par
         * défaut, donc le tracé se centre au lieu de s'étirer.
         */
        style={{ width: '100%', height: 'auto', maxHeight: '38vh', display: 'block' }}
        onMouseLeave={() => { setSurvole(null); onSurvol?.(null); }}
      >
        {tracesMetro.map((t) => (
          <path
            key={t.code}
            d={t.d}
            /* En mode cercles, le fond reste NEUTRE : colorer l'aplat ET
               dimensionner le cercle encoderait deux fois la même grandeur, et
               l'aplat réintroduirait le biais de surface que les cercles
               servent justement à éviter. */
            fill={mode === 'cercles' ? 'var(--bg-level-2)' : couleur(t.code)}
            {...traits(t.code)}
            style={{ cursor: onClic ? 'pointer' : 'default', transition: 'fill 200ms var(--ease-out)' }}
            onMouseEnter={() => { setSurvole(t.code); onSurvol?.(t.code); }}
            onClick={() => onClic?.(t.code)}
          >
            <title>{`${t.nom} — ${valeurs.has(t.code) ? formater(valeurs.get(t.code) as number) : 'aucune exposition'}`}</title>
          </path>
        ))}

        {mode === 'cercles' && tracesMetro.map((t) => {
          const v = valeurs.get(t.code);
          if (!t.c || v === undefined || !Number.isFinite(v) || v <= 0) return null;
          return (
            <circle
              key={`c-${t.code}`}
              cx={t.c[0]} cy={t.c[1]} r={rayon(v)}
              fill={rampe[rampe.length - 1]} fillOpacity={0.55}
              stroke={enAvant === t.code ? 'var(--brand-teal)' : rampe[rampe.length - 1]}
              strokeWidth={enAvant === t.code ? 1.4 : 0.5}
              style={{ pointerEvents: 'none' }}
            />
          );
        })}

        {/* Cartouches d'outre-mer. Encadrées et légendées : un territoire hors
            échelle doit se voir comme tel, jamais se fondre dans le cadre. */}
        {tracesOM.map((t) => (
          <g key={`om-${t.code}`}>
            <rect
              x={t.boite.x - 1} y={t.boite.y - 1} width={COTE_OM + 2} height={COTE_OM + 2}
              fill="none" stroke="var(--border-subtle)" strokeWidth={0.5}
            />
            <path
              d={t.d}
              fill={mode === 'cercles' ? 'var(--bg-level-2)' : couleur(t.code)}
              {...traits(t.code)}
              style={{ cursor: onClic ? 'pointer' : 'default' }}
              onMouseEnter={() => { setSurvole(t.code); onSurvol?.(t.code); }}
              onClick={() => onClic?.(t.code)}
            >
              <title>{`${t.nom} — ${formater(valeurs.get(t.code) as number)}`}</title>
            </path>
            {mode === 'cercles' && t.c && (
              <circle
                cx={t.c[0]} cy={t.c[1]} r={rayon(valeurs.get(t.code) as number)}
                fill={rampe[rampe.length - 1]} fillOpacity={0.55}
                stroke={rampe[rampe.length - 1]} strokeWidth={0.5}
                style={{ pointerEvents: 'none' }}
              />
            )}
            <text
              x={t.boite.x + COTE_OM / 2} y={t.boite.y + COTE_OM + 7}
              textAnchor="middle" style={{ fontFamily: fMono, fontSize: 7, fill: 'var(--text-tertiary)' }}
            >
              {t.code}
            </text>
          </g>
        ))}
      </svg>

      {/* Infobulle sous la carte plutôt que flottante : elle ne recouvre jamais
          le tracé, et reste lisible au clavier. */}
      <div style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)', minHeight: 16 }}>
        {enAvant ? (
          <>
            <span style={{ color: 'var(--text-primary)' }}>{nomActif}</span>
            {' — '}
            <span style={{ fontFamily: fMono }}>
              {valeurActive !== undefined ? formater(valeurActive) : 'aucune exposition'}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-tertiary)' }}>Survolez une unité</span>
        )}
      </div>

      {/* Échelle. Les bornes sont ÉCRITES : une rampe muette n'apprend rien, et
          c'est tout l'intérêt des seuils naturels de ne PAS être réguliers —
          ne pas les montrer reviendrait à cacher ce qu'on vient de gagner. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
          {rampe.slice(0, Math.max(bornes.length, 1)).map((c, i) => (
            <span key={i} style={{ flex: 1, background: c }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)' }}>
          {bornes.length > 0
            ? bornes.map((b, i) => <span key={i}>{formater(b)}</span>)
            : <span>aucune valeur</span>}
        </div>
        <div style={{ fontFamily: fMono, fontSize: 9, color: 'var(--text-tertiary)' }}>
          {libelleValeur} · seuils naturels{mode === 'cercles' ? ' · aire ∝ valeur' : ''}
        </div>

        {/* « Aucune exposition » n'est PAS la valeur la plus faible de la rampe :
            sans cette ligne, un département gris se lit « peu exposé » alors
            qu'il n'a aucun site. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
          <span style={{ width: 12, height: 6, borderRadius: 2, background: 'var(--donnee-absente)', border: '0.5px solid var(--text-tertiary)' }} />
          <span style={{ fontFamily: fInter, fontSize: 9, color: 'var(--text-tertiary)' }}>aucune exposition</span>
        </div>
      </div>
    </div>
  );
}

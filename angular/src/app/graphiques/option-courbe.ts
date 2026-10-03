import type { EChartsCoreOption } from 'echarts/core';

export interface SerieCourbe {
  cle: string;
  libelle: string;
  /** Nom de jeton sans `--` (ex. `brand-teal`, `nature-1`). */
  jeton: string;
  points: ReadonlyArray<readonly [number, number]>;
  /** Épaisseur du trait. Défaut 1,3, celui des courbes par nature de Recharts. */
  epaisseur?: number;
  /** Porte les étiquettes au kilomètre quand `etiquettes` est vrai (la courbe totale seulement), sur une série invisible à part. */
  etiquetee?: boolean;
}

export interface RepereCourbe {
  x: number;
  /** Absent côté React (le repère n'est pas nommé) : sans libellé, aucune étiquette n'est posée. */
  libelle?: string;
}

export interface CouleursCourbe {
  /** Couleur de chaque série, par `cle`. */
  series: Record<string, string>;
  /** Graduations (`--text-tertiary`). */
  texte: string;
  /** Texte de l'infobulle et des étiquettes (`--text-primary`). */
  textePrincipal: string;
  /** Grille horizontale (`--border-subtle`). */
  grille: string;
  /** Axes et leurs graduations (`--border-default`). */
  axe: string;
  fondInfobulle: string;
  bordInfobulle: string;
  /** Trait du repère (`--brand-teal`). */
  repere: string;
  /** Halo des étiquettes (`--bg-level-1`). */
  halo: string;
  /** Contour du point actif au survol (`--point-actif-contour`, invariant : `#fff` de Recharts). */
  pointActif: string;
}

/** `fMono` et `fInter` de `lib/design/polices.ts`. */
const MONO = "'JetBrains Mono','Fira Mono',monospace";
const INTER = "'Inter', system-ui, sans-serif";

/** Recharts : `margin` {top 4 (20 avec étiquettes), right 20, bottom 24, left 8} + axe Y de 54 px, axe X de 30 px, +8 px de remplissage à droite du conteneur. */
const GRILLE = { left: 62, right: 20, bottom: 54 };

/** Identifiant des séries d'étiquettes, écartées de l'infobulle partagée. */
const PREFIXE_ETIQUETTES = 'etiquettes:';

/** Décalage de l'infobulle par rapport au curseur (Recharts : `offset` 10). */
const DECALAGE_INFOBULLE = 10;

/**
 * Position de l'infobulle comme Recharts : à 10 px en bas à droite du curseur, retournée de l'autre côté
 * quand elle sortirait du graphique — et, retournée, jamais au-delà du COIN de la zone de tracé (`min`) : Recharts
 * borne par `viewBox.x` / `viewBox.y` (marge + axe Y), pas par le bord du conteneur. Mesuré au navigateur (T10) :
 * une infobulle haute de 14 lignes s'arrête à 62 px du bord gauche et au haut de la grille.
 */
export function positionInfobulle(
  point: readonly [number, number],
  contenu: readonly [number, number],
  vue: readonly [number, number],
  min: readonly [number, number] = [0, 0],
): [number, number] {
  const [x, y] = point;
  const gauche = x + DECALAGE_INFOBULLE + contenu[0] > vue[0] ? x - DECALAGE_INFOBULLE - contenu[0] : x + DECALAGE_INFOBULLE;
  const haut = y + DECALAGE_INFOBULLE + contenu[1] > vue[1] ? y - DECALAGE_INFOBULLE - contenu[1] : y + DECALAGE_INFOBULLE;
  return [Math.max(min[0], gauche), Math.max(min[1], haut)];
}

/** Échappe le texte injecté dans l'infobulle HTML (les libellés viennent de l'API). */
export function echapperHtml(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Graduations Y « rondes » de Recharts (`getNiceTickValues`, `tickCount` 5, domaine `[0, auto]`) : pas = 0,05 × 10^n
 * arrondi au-dessus du pas brut, puis centré sur le milieu du domaine et complété jusqu'à 5 graduations. Sans lui,
 * ECharts choisit les siennes (0-50 M par 10 M là où Recharts trace 0-60 M par 15 M) et la courbe n'a plus la même
 * hauteur relative que côté React. `null` sur un domaine vide (ECharts reprend la main).
 */
export function graduationsRecharts(max: number, n = 5, correction = 0): { min: number; max: number; pas: number } | null {
  if (!(max > 0) || !Number.isFinite(max)) return null;
  const brut = max / (n - 1);
  const chiffres = Math.floor(Math.log10(brut)) + 1;
  const puissance = 10 ** chiffres;
  const echelle = chiffres !== 1 ? 0.05 : 0.1;
  const pas = Number(((Math.ceil(brut / puissance / echelle) + correction) * echelle * puissance).toPrecision(12));
  const milieu = max / 2 - ((max / 2) % pas);
  let dessous = Math.ceil(milieu / pas);
  let dessus = Math.ceil((max - milieu) / pas);
  const total = dessous + dessus + 1;
  if (total > n) return graduationsRecharts(max, n, correction + 1);
  dessus += n - total;
  return { min: Number((milieu - dessous * pas).toPrecision(12)), max: Number((milieu + dessus * pas).toPrecision(12)), pas };
}

/** Construit l'option ECharts d'une courbe. PURE : testée sans ECharts ni DOM. */
export function optionCourbe(e: {
  series: SerieCourbe[];
  masquees: ReadonlySet<string>;
  couleurs: CouleursCourbe;
  formaterX: (x: number) => string;
  formaterY: (y: number) => string;
  /** Valeur complète d'une infobulle ; défaut `formaterY`. */
  formaterValeur?: (y: number) => string;
  /** Titre de l'infobulle pour une abscisse (« à moins de 5 km ») ; défaut `formaterX`. */
  formaterTitre?: (x: number) => string;
  /** Graduations X imposées (Recharts : `ticks`) ; défaut, l'intervalle automatique. */
  graduationsX?: readonly number[];
  repere?: RepereCourbe;
  domaineX?: readonly [number, number];
  /** Étiquettes de population aux kilomètres ronds, sur les séries `etiquetee`. */
  etiquettes?: boolean;
}): EChartsCoreOption {
  const c = e.couleurs;
  const formaterValeur = e.formaterValeur ?? e.formaterY;
  const formaterTitre = e.formaterTitre ?? e.formaterX;
  const visibles = e.series.filter((s) => !e.masquees.has(s.cle));
  const avecEtiquettes = e.etiquettes === true;
  const grilleY = graduationsRecharts(Math.max(0, ...visibles.flatMap((s) => s.points.map((p) => p[1]))));
  const graduation = { fontFamily: MONO, fontSize: 10, color: c.texte };
  const axe = { show: true, lineStyle: { color: c.axe, width: 1 } };
  const tick = { show: true, length: 6, lineStyle: { color: c.axe, width: 1 } };
  return {
    animation: false,
    grid: { left: GRILLE.left, right: GRILLE.right, bottom: GRILLE.bottom, top: avecEtiquettes ? 20 : 4 },
    xAxis: {
      type: 'value',
      min: e.domaineX?.[0],
      max: e.domaineX?.[1],
      axisLabel: {
        ...graduation,
        formatter: e.formaterX,
        ...(e.graduationsX ? { customValues: [...e.graduationsX] } : {}),
      },
      axisLine: axe,
      axisTick: { ...tick, ...(e.graduationsX ? { customValues: [...e.graduationsX] } : {}) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      ...(grilleY ? { min: grilleY.min, max: grilleY.max, interval: grilleY.pas } : {}),
      axisLabel: { ...graduation, formatter: e.formaterY },
      axisLine: axe,
      axisTick: tick,
      // Grille horizontale seule, pointillée 2 4 (`strokeDasharray="2 4"`).
      splitLine: { show: true, lineStyle: { color: c.grille, type: [2, 4], width: 1 } },
    },
    tooltip: {
      trigger: 'axis',
      // Plate (V7) : ECharts pose par défaut `shadowBlur: 10` et un bord de 1 px.
      backgroundColor: c.fondInfobulle,
      borderColor: c.bordInfobulle,
      borderWidth: 0.5,
      borderRadius: 6,
      padding: 10,
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      extraCssText: 'box-shadow:none;',
      textStyle: { fontFamily: INTER, fontSize: 11, color: c.textePrincipal },
      position: (point: [number, number], _p: unknown, _d: unknown, _r: unknown, taille: { contentSize: [number, number]; viewSize: [number, number] }) =>
        positionInfobulle(point, taille.contentSize, taille.viewSize, [GRILLE.left, avecEtiquettes ? 20 : 4]),
      axisPointer: { lineStyle: { color: c.axe, width: 1, type: 'solid' } },
      formatter: (params: unknown) => {
        const lignes = ((Array.isArray(params) ? params : [params]) as {
          seriesId?: string; seriesIndex?: number; seriesName: string; value: readonly [number, number]; color: string;
        }[]).filter((l) => !l.seriesId?.startsWith(PREFIXE_ETIQUETTES));
        if (lignes.length === 0) return '';
        // Ordre de l'infobulle de Recharts (`itemSorter` par défaut : le NOM de la série, c'est-à-dire sa CLÉ de
        // données, comparée unité de code par unité de code — « GPL » avant « Gaz », `*` avant tout). Mesuré au
        // navigateur sur l'étape ② (T10) ; les séries d'étiquettes, écartées plus haut, viennent après `visibles`.
        const cle = (l: { seriesIndex?: number }) => visibles[l.seriesIndex ?? -1]?.cle ?? '';
        lignes.sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
        // Titre et lignes comme l'infobulle par défaut de Recharts : titre sans marge, une ligne par
        // courbe à 4 px de haut et de bas, texte à la couleur du trait.
        const items = lignes
          .map((l) => `<li style="display:block;padding:4px 0;color:${l.color}">${echapperHtml(l.seriesName)} : ${echapperHtml(formaterValeur(Number(l.value[1])))}</li>`)
          .join('');
        return `<p style="margin:0">${echapperHtml(formaterTitre(Number(lignes[0].value[0])))}</p>`
          + `<ul style="list-style:none;padding:0;margin:0">${items}</ul>`;
      },
    },
    series: [
      ...visibles.map((s, i) => ({
        type: 'line',
        name: s.libelle,
        data: s.points.map((p) => [p[0], p[1]]),
        // `monotone` de Recharts : courbe lissée qui ne dépasse jamais ses points.
        smooth: true,
        smoothMonotone: 'x',
        // Point actif au survol comme Recharts : disque plein de rayon 4, bord de 2 px.
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: { color: c.series[s.cle], width: s.epaisseur ?? 1.3 },
        itemStyle: { color: c.series[s.cle], borderWidth: 2, borderColor: c.pointActif },
        ...(i === 0 && e.repere
          ? {
              markLine: {
                symbol: 'none',
                silent: true,
                lineStyle: { color: c.repere, type: [3, 3], width: 1 },
                label: e.repere.libelle
                  ? { fontFamily: INTER, fontSize: 10, color: c.texte, position: 'insideEndTop', formatter: e.repere.libelle }
                  : { show: false },
                data: [{ xAxis: e.repere.x }],
              },
            }
          : {}),
      })),
      // Les étiquettes au kilomètre vivent sur une série INVISIBLE, jamais sur la courbe : elles ne peuvent
      // s'accrocher qu'à des symboles de taille nulle, ce qui ôterait son point de survol à la vraie courbe.
      ...(avecEtiquettes
        ? visibles.filter((s) => s.etiquetee === true).map((s) => ({
            type: 'line',
            id: `${PREFIXE_ETIQUETTES}${s.cle}`,
            name: s.libelle,
            data: s.points.map((p) => [p[0], p[1]]),
            silent: true,
            tooltip: { show: false },
            showSymbol: true,
            symbolSize: 0,
            lineStyle: { width: 0, opacity: 0 },
            label: {
              show: true,
              position: 'top',
              distance: 8,
              fontFamily: MONO,
              fontSize: 10,
              color: c.textePrincipal,
              textBorderColor: c.halo,
              textBorderWidth: 3,
              // Un point tous les 100 m : seuls les kilomètres ronds portent un chiffre.
              formatter: (p: { value: readonly [number, number] }) =>
                p.value[0] % 1000 === 0 ? e.formaterY(p.value[1]) : '',
            },
          }))
        : []),
    ],
  };
}

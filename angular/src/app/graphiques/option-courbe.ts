import type { EChartsCoreOption } from 'echarts/core';

export interface SerieCourbe {
  cle: string;
  libelle: string;
  /** Nom de jeton sans `--` (ex. `brand-teal`, `nature-1`). */
  jeton: string;
  points: ReadonlyArray<readonly [number, number]>;
  /** Épaisseur du trait. Défaut 1,3, celui des courbes par nature de Recharts. */
  epaisseur?: number;
  /** Porte les étiquettes au kilomètre quand `etiquettes` est vrai (la courbe totale seulement). */
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
}

/** `fMono` et `fInter` de `lib/design/polices.ts`. */
const MONO = "'JetBrains Mono','Fira Mono',monospace";
const INTER = "'Inter', system-ui, sans-serif";

/** Recharts : `margin` {top 4 (20 avec étiquettes), right 20, bottom 24, left 8} + axe Y de 54 px, axe X de 30 px, +8 px de remplissage à droite du conteneur. */
const GRILLE = { left: 62, right: 20, bottom: 54 };

/** Échappe le texte injecté dans l'infobulle HTML (les libellés viennent de l'API). */
export function echapperHtml(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
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
      axisPointer: { lineStyle: { color: c.axe, width: 1, type: 'solid' } },
      formatter: (params: unknown) => {
        const lignes = (Array.isArray(params) ? params : [params]) as {
          seriesName: string; value: readonly [number, number]; color: string;
        }[];
        if (lignes.length === 0) return '';
        // Titre et lignes comme l'infobulle par défaut de Recharts : titre sans marge, une ligne par
        // courbe à 4 px de haut et de bas, texte à la couleur du trait.
        const items = lignes
          .map((l) => `<li style="display:block;padding:4px 0;color:${l.color}">${echapperHtml(l.seriesName)} : ${echapperHtml(formaterValeur(Number(l.value[1])))}</li>`)
          .join('');
        return `<p style="margin:0">${echapperHtml(formaterTitre(Number(lignes[0].value[0])))}</p>`
          + `<ul style="list-style:none;padding:0;margin:0">${items}</ul>`;
      },
    },
    series: visibles.map((s, i) => {
      const etiquetee = avecEtiquettes && s.etiquetee === true;
      return {
        type: 'line',
        name: s.libelle,
        data: s.points.map((p) => [p[0], p[1]]),
        // `monotone` de Recharts : courbe lissée qui ne dépasse jamais ses points.
        smooth: true,
        smoothMonotone: 'x',
        // Les étiquettes s'accrochent aux symboles : on en pose, de taille nulle, quand elles sont demandées.
        showSymbol: etiquetee,
        symbolSize: etiquetee ? 0 : 4,
        lineStyle: { color: c.series[s.cle], width: s.epaisseur ?? 1.3 },
        itemStyle: { color: c.series[s.cle] },
        ...(etiquetee
          ? {
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
            }
          : {}),
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
      };
    }),
  };
}

/**
 * Les options ECharts des graphiques du rapport d'un modèle — les `PieChart`, `BarChart` et `ScatterChart` Recharts de
 * `components/ClusterDetails.tsx` (lot 4, T19), réécrits sur ECharts, déjà dépendance du projet (B8 : aucune nouvelle).
 *
 * Fonctions PURES : elles reçoivent des couleurs CALCULÉES (`CadreGraphique`, lues par `CouleursService` — ECharts ne
 * résout pas `var()`) et rendent un objet d'options ; `mg-graphique` le pose. Les teintes des clusters sont celles que
 * rend la route (hexadécimaux de DONNÉES, identiques dans les deux thèmes).
 *
 * Correspondances avec Recharts : graduations Inter 11 px (`axisStyle`), infobulle sombre JetBrains Mono 10 px
 * (`DarkTooltip`), barres arrondies à droite (`radius={[0, 2, 2, 0]}`), catégories lues de HAUT en BAS (ordre des
 * données — un axe catégoriel ECharts monte de bas en haut : `inverse`).
 */
import { echapperHtml } from '../../../../graphiques/option-courbe';
import { couleurBadge } from './panneau';

/** Les couleurs d'interface des graphiques, déjà résolues. */
export interface CadreGraphique {
  /** `--text-secondary` : graduations, légende (`C.muted`). */
  texte: string;
  /** `--text-tertiary` : titres d'axe, repères (`C.dim`). */
  texteDiscret: string;
  textePrincipal: string;
  /** `--border-subtle` : axes, grille, ligne 0 (`C.border`). */
  bord: string;
  /** `--bg-surface` : fond de l'infobulle (`C.bgCard`). */
  fondInfobulle: string;
  /** `--success` : écart positif (`#22c55e` en React). */
  positif: string;
  /** `--danger` : écart négatif (`#ef4444` en React). */
  negatif: string;
  /** `--text-tertiary` : la série « Moy. France » (`#6b7280` en React). */
  reference: string;
}

/** Une barre, une part : un nom, une valeur, la teinte du cluster. */
export interface ValeurColoree {
  nom: string;
  valeur: number;
  couleur: string;
}

const INTER = "'Inter', system-ui, sans-serif";
const MONO = "'JetBrains Mono', monospace";

/** L'infobulle sombre de React (`DarkTooltip`) : fond carte, bord fin, JetBrains Mono 10 px. */
function infobulle(c: CadreGraphique, formatter: unknown, declencheur: 'item' | 'axis' = 'item'): Record<string, unknown> {
  return {
    trigger: declencheur, confine: true, formatter,
    backgroundColor: c.fondInfobulle, borderColor: c.bord, borderWidth: 1, borderRadius: 2, padding: [8, 12],
    textStyle: { fontFamily: MONO, fontSize: 10, color: c.textePrincipal },
    extraCssText: 'box-shadow: none;',
  };
}

/**
 * Une ligne de l'infobulle : « nom: valeur », la valeur dans la teinte de la série. La teinte d'un cluster vient de la
 * base et entre dans du HTML (l'infobulle ECharts est posée en `innerHTML`) : elle passe par `couleurBadge` — un
 * hexadécimal, ou le gris de la donnée absente (revue 1).
 */
function ligne(c: CadreGraphique, nom: string, valeur: string, couleur: string): string {
  return `<div style="display:flex;gap:8px"><span style="color:${c.texte}">${echapperHtml(nom)}:</span><span style="color:${couleurBadge(couleur)}">${echapperHtml(valeur)}</span></div>`;
}

const legende = (c: CadreGraphique) => ({
  bottom: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { fontFamily: MONO, fontSize: 10, color: c.texte },
});
const axeValeurs = (c: CadreGraphique, extra: Record<string, unknown> = {}) => ({
  type: 'value', axisLine: { show: true, lineStyle: { color: c.bord } }, axisTick: { show: false }, splitLine: { show: false },
  axisLabel: { fontFamily: INTER, fontSize: 11, color: c.texte }, ...extra,
});
const axeCategories = (c: CadreGraphique, noms: readonly string[], largeur: number, taille = 11) => ({
  type: 'category', data: [...noms], inverse: true, axisLine: { show: false }, axisTick: { show: false },
  axisLabel: { fontFamily: INTER, fontSize: taille, color: c.texte, width: largeur - 8, overflow: 'truncate' },
});

/** « Répartition des clusters » : anneau 55 → 85 px, écart 2°, pourcentage arrondi, légende en bas (`TabResume`). */
export function optionDonut(parts: readonly ValeurColoree[], c: CadreGraphique): Record<string, unknown> {
  const total = parts.reduce((s, p) => s + p.valeur, 0);
  return {
    animation: false,
    tooltip: infobulle(c, (p: { name: string; value: number; color: string }) =>
      ligne(c, p.name, `${p.value} POI (${total > 0 ? ((p.value / total) * 100).toFixed(1) : 0}%)`, p.color)),
    legend: legende(c),
    series: [{
      type: 'pie', radius: [55, 85], center: ['50%', '45%'], padAngle: 2, avoidLabelOverlap: true,
      label: { formatter: (p: { percent: number }) => `${(p.percent ?? 0).toFixed(0)}%`, fontFamily: INTER, fontSize: 11, color: c.texte },
      labelLine: { show: false },
      data: parts.map((p) => ({ name: p.nom, value: p.valeur, itemStyle: { color: p.couleur } })),
    }],
  };
}

/** « Distribution » et « Taille des clusters » : barres horizontales, une teinte par cluster, repère « idéal » optionnel. */
export function optionBarres(
  barres: readonly ValeurColoree[], c: CadreGraphique, o: { largeurAxe: number; ideal?: number; margeDroite?: number },
): Record<string, unknown> {
  return {
    animation: false,
    grid: { left: 4 + o.largeurAxe, right: o.margeDroite ?? 40, top: 0, bottom: 24 },
    tooltip: infobulle(c, (p: { name: string; value: number; color: string }) => ligne(c, p.name, `${p.value} POI`, p.color)),
    xAxis: axeValeurs(c),
    yAxis: axeCategories(c, barres.map((b) => b.nom), o.largeurAxe),
    series: [{
      type: 'bar', barMaxWidth: 28, itemStyle: { borderRadius: [0, 2, 2, 0] },
      data: barres.map((b) => ({ value: b.valeur, itemStyle: { color: b.couleur } })),
      ...(o.ideal !== undefined ? {
        markLine: {
          symbol: 'none', silent: true, lineStyle: { color: c.bord, type: [4, 2], width: 1 },
          data: [{ xAxis: o.ideal, label: { formatter: 'idéal', position: 'insideEndTop', color: c.texteDiscret, fontSize: 8 } }],
        },
      } : {}),
    }],
  };
}

/** « Écart vs France » d'un cluster : barres signées, vert au-dessus de la moyenne, rouge en dessous (`TabProfils`). */
export function optionBarresEcart(ecarts: readonly { variable: string; ecart: number }[], c: CadreGraphique): Record<string, unknown> {
  const signe = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
  return {
    animation: false,
    grid: { left: 4 + 72, right: 8, top: 0, bottom: 20 },
    tooltip: infobulle(c, (ps: { name: string; value: number; color: string }[]) =>
      ps.map((p) => ligne(c, p.name, `${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(2)} pp`, p.color)).join(''), 'axis'),
    xAxis: axeValeurs(c, { axisLabel: { fontFamily: MONO, fontSize: 8, color: c.texteDiscret, formatter: signe } }),
    yAxis: axeCategories(c, ecarts.map((e) => e.variable), 72, 10),
    series: [{
      type: 'bar', barMaxWidth: 14, itemStyle: { borderRadius: [0, 2, 2, 0], opacity: 0.8 },
      data: ecarts.map((e) => ({ value: e.ecart, itemStyle: { color: e.ecart >= 0 ? c.positif : c.negatif } })),
      markLine: { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: c.bord, width: 1.5, type: 'solid' }, data: [{ xAxis: 0 }] },
    }],
  };
}

/** « Comparaison par feature — clusters vs France » : une série par cluster (en %), puis la moyenne nationale. */
export function optionBarresGroupees(
  variables: readonly string[], series: readonly { nom: string; couleur: string; valeurs: readonly number[] }[],
  france: readonly number[], c: CadreGraphique,
): Record<string, unknown> {
  const barre = (nom: string, couleur: string, valeurs: readonly number[], opacite: number) => ({
    type: 'bar', name: nom, data: [...valeurs], barMaxWidth: 10, itemStyle: { color: couleur, opacity: opacite, borderRadius: [0, 2, 2, 0] },
  });
  return {
    animation: false,
    grid: { left: 8 + 88, right: 16, top: 0, bottom: 64 },
    tooltip: infobulle(c, (ps: { seriesName: string; value: number; color: string; name: string }[]) =>
      `<div style="color:${c.texte};font-size:9px;margin-bottom:4px">${echapperHtml(ps[0]?.name ?? '')}</div>`
      + ps.map((p) => ligne(c, p.seriesName, `${p.value.toFixed(1)}%`, p.color)).join(''), 'axis'),
    legend: legende(c),
    xAxis: axeValeurs(c, {
      name: '% (0–100)', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: c.texteDiscret, fontSize: 9 },
      axisLabel: { fontFamily: MONO, fontSize: 9, color: c.texte, formatter: (v: number) => `${v}%` },
      splitLine: { show: true, lineStyle: { color: c.bord, type: [3, 3] } },
    }),
    yAxis: axeCategories(c, variables, 88, 10),
    series: [
      ...series.map((s) => barre(s.nom, s.couleur, s.valeurs, 0.85)),
      ...(france.length ? [barre('Moy. France', c.reference, france, 0.5)] : []),
    ],
  };
}

/** Un point du nuage PCA. */
export interface PointPca {
  x: number;
  y: number;
  nom: string;
  ville: string;
}

/** « Scatter PCA — PC1 vs PC2 » : une série par cluster, repères 0 en tirets, infobulle nom · ville · composantes. */
export function optionNuagePca(
  groupes: readonly { nom: string; couleur: string; points: readonly PointPca[] }[], c: CadreGraphique,
): Record<string, unknown> {
  const repere = { symbol: 'none', silent: true, label: { show: false }, lineStyle: { color: c.bord, type: [4, 3], width: 1 } };
  return {
    animation: false,
    grid: { left: 12 + 48, right: 20, top: 16, bottom: 32 + 40 },
    tooltip: infobulle(c, (p: { data: { nom: string; ville: string; value: [number, number] } }) =>
      `<div style="color:${c.textePrincipal};font-weight:600">${echapperHtml(p.data.nom)}</div>`
      + `<div style="color:${c.texte}">${echapperHtml(p.data.ville)}</div>`
      + `<div style="color:${c.texteDiscret};margin-top:4px">PC1 ${p.data.value[0].toFixed(3)} · PC2 ${p.data.value[1].toFixed(3)}</div>`),
    legend: legende(c),
    xAxis: axeValeurs(c, {
      scale: true, name: 'Composante PCA 1', nameLocation: 'middle', nameGap: 26,
      nameTextStyle: { color: c.texteDiscret, fontSize: 9, fontFamily: INTER },
    }),
    yAxis: axeValeurs(c, {
      scale: true, name: 'PCA 2', nameLocation: 'middle', nameGap: 36, nameRotate: 90,
      nameTextStyle: { color: c.texteDiscret, fontSize: 9, fontFamily: INTER },
    }),
    series: groupes.map((g, i) => ({
      type: 'scatter', name: g.nom, symbolSize: 6, itemStyle: { color: g.couleur, opacity: 0.75 },
      data: g.points.map((p) => ({ value: [p.x, p.y], nom: p.nom, ville: p.ville })),
      ...(i === 0 ? { markLine: { ...repere, data: [{ xAxis: 0 }, { yAxis: 0 }] } } : {}),
    })),
  };
}

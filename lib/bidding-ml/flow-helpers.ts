/**
 * Helpers de calcul pour les visualisations narratives du module Pilotage ML.
 *
 *  - polygonCentroid()   : centre bbox d'un polygone CP
 *  - buildZoneDeltas()   : tableau des deltas par CP avec centroïde + valeur INSEE
 *  - aggregateByDept()   : agrège les CP au niveau département (2 premiers chars CP)
 *                          centroïde pondéré, somme impressions, taux abstention pondéré
 *  - buildAbstentionBins(): histogramme des impressions par tranche d'abstention
 *
 * Pas d'I/O, pas de dépendance externe — calculs JS purs.
 */

export interface ZoneDelta {
  postal_code: string;
  centroid: [number, number];
  delta: number;
  abs_delta: number;
  abstention_rate: number | null;
  real: number;
  sim: number;
}

export interface DeptAgg {
  dept: string;            // ex: '93'
  centroid: [number, number];
  real: number;            // total impressions réelles
  sim: number;             // total impressions simulées
  abstention_rate: number; // moyenne pondérée par impressions sim
  n_cp: number;
}

export interface RegionAgg {
  region: string;
  centroid: [number, number];
  real: number;
  sim: number;
  abstention_rate: number;
  n_dept: number;
}

/**
 * Mapping département (FR INSEE) → région métropolitaine + DROM.
 * Source : codes officiels INSEE post-2016 réforme territoriale.
 */
const DEPT_TO_REGION: Record<string, string> = {
  // Auvergne-Rhône-Alpes
  '01': 'ARA', '03': 'ARA', '07': 'ARA', '15': 'ARA', '26': 'ARA', '38': 'ARA', '42': 'ARA', '43': 'ARA', '63': 'ARA', '69': 'ARA', '73': 'ARA', '74': 'ARA',
  // Bourgogne-Franche-Comté
  '21': 'BFC', '25': 'BFC', '39': 'BFC', '58': 'BFC', '70': 'BFC', '71': 'BFC', '89': 'BFC', '90': 'BFC',
  // Bretagne
  '22': 'BRE', '29': 'BRE', '35': 'BRE', '56': 'BRE',
  // Centre-Val de Loire
  '18': 'CVL', '28': 'CVL', '36': 'CVL', '37': 'CVL', '41': 'CVL', '45': 'CVL',
  // Corse
  '2A': 'COR', '2B': 'COR', '20': 'COR',
  // Grand Est
  '08': 'GES', '10': 'GES', '51': 'GES', '52': 'GES', '54': 'GES', '55': 'GES', '57': 'GES', '67': 'GES', '68': 'GES', '88': 'GES',
  // Hauts-de-France
  '02': 'HDF', '59': 'HDF', '60': 'HDF', '62': 'HDF', '80': 'HDF',
  // Île-de-France
  '75': 'IDF', '77': 'IDF', '78': 'IDF', '91': 'IDF', '92': 'IDF', '93': 'IDF', '94': 'IDF', '95': 'IDF',
  // Normandie
  '14': 'NOR', '27': 'NOR', '50': 'NOR', '61': 'NOR', '76': 'NOR',
  // Nouvelle-Aquitaine
  '16': 'NAQ', '17': 'NAQ', '19': 'NAQ', '23': 'NAQ', '24': 'NAQ', '33': 'NAQ', '40': 'NAQ', '47': 'NAQ', '64': 'NAQ', '79': 'NAQ', '86': 'NAQ', '87': 'NAQ',
  // Occitanie
  '09': 'OCC', '11': 'OCC', '12': 'OCC', '30': 'OCC', '31': 'OCC', '32': 'OCC', '34': 'OCC', '46': 'OCC', '48': 'OCC', '65': 'OCC', '66': 'OCC', '81': 'OCC', '82': 'OCC',
  // Pays de la Loire
  '44': 'PDL', '49': 'PDL', '53': 'PDL', '72': 'PDL', '85': 'PDL',
  // Provence-Alpes-Côte d'Azur
  '04': 'PAC', '05': 'PAC', '06': 'PAC', '13': 'PAC', '83': 'PAC', '84': 'PAC',
  // DROM
  '971': 'GUA', '972': 'MAR', '973': 'GUF', '974': 'REU', '976': 'MAY',
};

export interface AbstentionBin {
  /** Label narratif court ("<25%", "25-35%", ...). */
  label: string;
  /** Label narratif explicite ("Faible", "Forte", ...). */
  narrative: string;
  /** Bornes [min, max). */
  range: [number, number];
  /** Couleur de fond (palette chaleur) pour le bin. */
  color: string;
  /** Total impressions réelles dans le bin. */
  real: number;
  /** Total impressions simulées dans le bin. */
  sim: number;
  /** Part du total réel (0..1). */
  share_real: number;
  /** Part du total sim (0..1). */
  share_sim: number;
}

const HEAT_COLORS = ['#fff5b8', '#ffd84d', '#ff8c1a', '#e63946', '#9d0208'];

/**
 * Calcule le centroïde (bbox center) d'un polygone GeoJSON.
 */
export function polygonCentroid(geom: GeoJSON.Geometry | undefined): [number, number] | null {
  if (!geom) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (coords: GeoJSON.Position[]) => {
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  };
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) visit(ring);
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) for (const ring of poly) visit(ring);
  } else {
    return null;
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

export function buildZoneDeltas(
  geojson: GeoJSON.FeatureCollection | null,
  insseValues: Record<string, number> | null,
  fieldDelta: string,
  fieldReal: string,
  fieldSim: string,
): ZoneDelta[] {
  if (!geojson) return [];
  const out: ZoneDelta[] = [];
  for (const f of geojson.features) {
    const cp = String(f.properties?.code_postal ?? '');
    if (!cp) continue;
    const delta = Number(f.properties?.[fieldDelta] ?? 0);
    const c = polygonCentroid(f.geometry);
    if (!c) continue;
    out.push({
      postal_code: cp,
      centroid: c,
      delta,
      abs_delta: Math.abs(delta),
      abstention_rate: insseValues?.[cp] ?? null,
      real: Number(f.properties?.[fieldReal] ?? 0),
      sim: Number(f.properties?.[fieldSim] ?? 0),
    });
  }
  return out;
}

/**
 * Agrège les CP au niveau département (2 premiers chars du code postal).
 * - Centroïde pondéré par les impressions sim (les zones où on diffuse pèsent plus)
 * - Somme des impressions réelles et simulées
 * - Taux d'abstention pondéré par les impressions sim
 *
 * Pour DROM (codes 97x) on prend 3 premiers chars pour distinguer les départements.
 */
export function aggregateByDept(zones: ZoneDelta[]): DeptAgg[] {
  const acc = new Map<string, {
    sumLng: number; sumLat: number; weight: number;
    real: number; sim: number;
    sumRate: number; rateWeight: number;
    n: number;
  }>();

  for (const z of zones) {
    const cp = z.postal_code;
    const dept = cp.startsWith('97') || cp.startsWith('98') ? cp.slice(0, 3) : cp.slice(0, 2);
    if (!dept) continue;
    const entry = acc.get(dept) ?? {
      sumLng: 0, sumLat: 0, weight: 0,
      real: 0, sim: 0,
      sumRate: 0, rateWeight: 0,
      n: 0,
    };
    // Poids du centroïde : sim si > 0 sinon real sinon 1
    const w = z.sim > 0 ? z.sim : (z.real > 0 ? z.real : 1);
    entry.sumLng += z.centroid[0] * w;
    entry.sumLat += z.centroid[1] * w;
    entry.weight += w;
    entry.real += z.real;
    entry.sim += z.sim;
    if (z.abstention_rate !== null && Number.isFinite(z.abstention_rate)) {
      const rw = z.sim > 0 ? z.sim : 1;
      entry.sumRate += z.abstention_rate * rw;
      entry.rateWeight += rw;
    }
    entry.n += 1;
    acc.set(dept, entry);
  }

  const out: DeptAgg[] = [];
  for (const [dept, e] of acc) {
    if (e.weight === 0) continue;
    out.push({
      dept,
      centroid: [e.sumLng / e.weight, e.sumLat / e.weight],
      real: e.real,
      sim: e.sim,
      abstention_rate: e.rateWeight > 0 ? e.sumRate / e.rateWeight : 0,
      n_cp: e.n,
    });
  }
  return out;
}

/**
 * Agrège les départements au niveau région métropolitaine + DROM.
 */
export function aggregateByRegion(depts: DeptAgg[]): RegionAgg[] {
  const acc = new Map<string, {
    sumLng: number; sumLat: number; weight: number;
    real: number; sim: number;
    sumRate: number; rateWeight: number;
    n: number;
  }>();
  for (const d of depts) {
    const region = DEPT_TO_REGION[d.dept];
    if (!region) continue;
    const entry = acc.get(region) ?? {
      sumLng: 0, sumLat: 0, weight: 0,
      real: 0, sim: 0, sumRate: 0, rateWeight: 0, n: 0,
    };
    const w = d.sim > 0 ? d.sim : (d.real > 0 ? d.real : 1);
    entry.sumLng += d.centroid[0] * w;
    entry.sumLat += d.centroid[1] * w;
    entry.weight += w;
    entry.real += d.real;
    entry.sim += d.sim;
    if (Number.isFinite(d.abstention_rate)) {
      const rw = d.sim > 0 ? d.sim : 1;
      entry.sumRate += d.abstention_rate * rw;
      entry.rateWeight += rw;
    }
    entry.n += 1;
    acc.set(region, entry);
  }
  const out: RegionAgg[] = [];
  for (const [region, e] of acc) {
    if (e.weight === 0) continue;
    out.push({
      region,
      centroid: [e.sumLng / e.weight, e.sumLat / e.weight],
      real: e.real,
      sim: e.sim,
      abstention_rate: e.rateWeight > 0 ? e.sumRate / e.rateWeight : 0,
      n_dept: e.n,
    });
  }
  return out;
}

/**
 * Histogramme des impressions par tranche d'abstention.
 * 5 bins de 10 pts chacun couvrant la distribution typique française.
 */
export function buildAbstentionBins(zones: ZoneDelta[]): AbstentionBin[] {
  const bins: AbstentionBin[] = [
    { label: '<25%', narrative: 'Faible',     range: [-Infinity, 25], color: HEAT_COLORS[0], real: 0, sim: 0, share_real: 0, share_sim: 0 },
    { label: '25-35%', narrative: 'Modérée',  range: [25, 35],         color: HEAT_COLORS[1], real: 0, sim: 0, share_real: 0, share_sim: 0 },
    { label: '35-45%', narrative: 'Forte',    range: [35, 45],         color: HEAT_COLORS[2], real: 0, sim: 0, share_real: 0, share_sim: 0 },
    { label: '45-55%', narrative: 'Très forte', range: [45, 55],       color: HEAT_COLORS[3], real: 0, sim: 0, share_real: 0, share_sim: 0 },
    { label: '>55%',   narrative: 'Extrême',  range: [55, Infinity],   color: HEAT_COLORS[4], real: 0, sim: 0, share_real: 0, share_sim: 0 },
  ];

  let totalReal = 0, totalSim = 0;
  for (const z of zones) {
    if (z.abstention_rate === null || !Number.isFinite(z.abstention_rate)) continue;
    const r = z.abstention_rate;
    const bin = bins.find(b => r >= b.range[0] && r < b.range[1]);
    if (!bin) continue;
    bin.real += z.real;
    bin.sim += z.sim;
    totalReal += z.real;
    totalSim += z.sim;
  }
  for (const b of bins) {
    b.share_real = totalReal > 0 ? b.real / totalReal : 0;
    b.share_sim = totalSim > 0 ? b.sim / totalSim : 0;
  }
  return bins;
}

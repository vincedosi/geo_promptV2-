/**
 * Logique PURE de la carte de l'étape ⑤ (`cartes/carte-campagne.component.ts`) : identifiants des sources et couches,
 * jetons de la palette fixe, fusion des chiffres d'une période dans les géométries déjà chargées, cadrage, bulle de
 * survol. Sortie du composant au lot 4 (T22) : le composant ne garde que le cycle de vie MapLibre et les lectures.
 */
import { type Bbox, CADRE_METROPOLE } from '../../../carte/bbox';
import { formaterDecimal, formaterNombre } from '../../../core/format/nombre';
import { trancheIndice } from './palette-divergente';
import { type LigneZone, type VueSimulation, etatSite } from './simulation/vue';

export const S_BASSINS = 'sim-bassins';
export const S_SITES = 'sim-sites';
export const S_CERCLES = 'sim-cercles';
export const S_CP = 'sim-cp';
export const L_BASSINS = 'sim-bassins-fond';
export const L_BASSINS_CONTOUR = 'sim-bassins-contour';
export const L_BASSINS_ETIQUETTE = 'sim-bassins-etiquette';
export const L_CP = 'sim-cp-fond';
export const L_CP_CONTOUR = 'sim-cp-contour';
export const L_CERCLES = 'sim-cercles-couche';
export const L_SITES = 'sim-sites-couche';

/** Bassins (par défaut) ou codes postaux — état LOCAL, comme React (`mode`). */
export type LectureCampagne = 'bassins' | 'cp';
export type Collection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;
/** Les géométries du cadre visible : AUCUN chiffre de diffusion dedans (la route n'en rend pas). */
export interface GeometriesCampagne { bassins: Collection; sites: Collection; cp: Collection }

export const vide = (): Collection => ({ type: 'FeatureCollection', features: [] });

/**
 * Les jetons de cette carte, lus dans le thème CLAIR quel que soit le thème courant (A11) : le fond Positron est clair
 * dans les deux thèmes, et le vert fluo du thème sombre y serait illisible (`CarteCampagne.tsx:70-75`). Chaque entrée
 * est le jeton dont `lib/simulation/palette-carte.ts` se dit le MIROIR — aucune couleur recopiée.
 * Seule exception, listée au rapport T17 : le halo des étiquettes (React `rgba(255,255,255,0.9)`, « miroir de
 * `--halo-carte` clair ») prend `--halo-carte` clair lui-même, 0,85.
 */
export const JETONS_CAMPAGNE = {
  teal: 'brand-teal', fuite: 'text-tertiary', actif: 'text-primary', halo: 'halo-carte', contour: 'contour-carte',
  servi: 'success', partiel: 'warning', sousServi: 'danger',
  d0: 'diverge-sous-3', d1: 'diverge-sous-2', d2: 'diverge-sous-1', d3: 'diverge-neutre',
  d4: 'diverge-sur-1', d5: 'diverge-sur-2', d6: 'diverge-sur-3',
} as const;
export type TeintesCampagne = Record<keyof typeof JETONS_CAMPAGNE, string>;

export const rampeDe = (t: TeintesCampagne) => [t.d0, t.d1, t.d2, t.d3, t.d4, t.d5, t.d6];

/** La couleur d'un indice de pression : la tranche divergente, ou le gris de fuite SANS indice (jamais « conforme »). */
export function couleurIndice(indice: number | null | undefined, t: TeintesCampagne): string {
  const i = trancheIndice(indice);
  return i < 0 ? t.fuite : rampeDe(t)[i];
}

/** La couleur d'un site : la pression reçue par son bassin (`etatSite`). */
export function couleurSite(indice: number | null, t: TeintesCampagne): string {
  const e = etatSite(indice);
  return e === 'servi' ? t.servi : e === 'partiel' ? t.partiel : e === 'sous_servi' ? t.sousServi : t.fuite;
}

/**
 * Les chiffres de la période FUSIONNÉS dans les géométries déjà chargées (`CarteCampagne.tsx:206-292`) — fonction pure.
 * Changer de période, de zone active ou d'interrupteur repasse ici et nulle part ailleurs : aucune géométrie redemandée.
 */
export function fusionnerDiffusion(
  geo: GeometriesCampagne, vue: VueSimulation, zoneActive: string | null, mode: LectureCampagne, cercles: boolean,
  t: TeintesCampagne,
): GeometriesCampagne & { cerclesFc: Collection } {
  const parZone = new Map<string, LigneZone>(vue.zones.map((z) => [z.id, z]));
  const bassins: Collection = {
    type: 'FeatureCollection',
    features: geo.bassins.features.map((f) => {
      const z = parZone.get(String(f.properties['id']));
      const actif = zoneActive === f.properties['id'];
      return {
        ...f,
        properties: {
          ...f.properties,
          couleur: couleurIndice(z?.indice, t),
          contour: actif ? t.actif : t.contour,
          epaisseur: actif ? 2.5 : 0.8,
          indice: z?.indice ?? null,
          etiquette: `${f.properties['nom']} ${z?.indice == null ? '' : Math.round(z.indice)}`,
        },
      };
    }),
  };
  const sites: Collection = {
    type: 'FeatureCollection',
    features: geo.sites.features.map((f) => {
      const z = parZone.get(String(f.properties['cluster_id']));
      return { ...f, properties: { ...f.properties, couleur: couleurSite(z?.indice ?? null, t), halo: t.halo } };
    }),
  };
  // Un cercle par POSITION : les codes postaux d'un même groupe partagent un centroïde (sql/228), et quatre cercles
  // superposés feraient passer Nantes pour un seul code postal quatre fois plus foncé.
  const parPosition = new Map<string, { x: number; y: number; imps: number; achete: boolean; codes: string[] }>();
  for (const c of vue.cps) {
    if (c.x == null || c.y == null || c.impressions <= 0) continue;
    const cle = `${c.x}|${c.y}`;
    const o = parPosition.get(cle) ?? { x: c.x, y: c.y, imps: 0, achete: false, codes: [] };
    o.imps += c.impressions;
    o.achete = o.achete || c.achete;
    o.codes.push(c.code_postal);
    parPosition.set(cle, o);
  }
  const max = Math.max(1, ...[...parPosition.values()].map((o) => o.imps));
  const cerclesFc: Collection = {
    type: 'FeatureCollection',
    features: cercles ? [...parPosition.values()].map((o) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [o.x, o.y] },
      properties: {
        r: Math.sqrt(o.imps / max), couleur: o.achete ? t.teal : t.fuite, halo: t.halo,
        imps: o.imps, achete: o.achete, codes: o.codes.join(', '),
      },
    })) : [],
  };
  const parCp = new Map(vue.cps.map((c) => [c.code_postal, c]));
  const cp: Collection = {
    type: 'FeatureCollection',
    features: mode === 'cp' ? geo.cp.features.map((f) => {
      const c = parCp.get(String(f.properties['code_postal']));
      return {
        ...f,
        properties: {
          ...f.properties, couleur: couleurIndice(c?.indice, t), contour: t.contour,
          indice_cp: c?.indice ?? null, imps: c?.impressions ?? 0,
        },
      };
    }) : [],
  };
  return { bassins, sites, cp, cerclesFc };
}

/**
 * La métropole seule (`CarteCampagne.tsx:178-187`) : un bassin de Guyane étirerait le cadre jusqu'à l'Atlantique et la
 * France entière tiendrait dans un timbre-poste.
 */
export function cadreDesZones(zones: readonly LigneZone[]): Bbox | null {
  const m = CADRE_METROPOLE;
  const bs = zones.map((z) => z.bbox)
    .filter((b): b is [number, number, number, number] => !!b)
    .filter((b) => b[0] >= m[0] && b[2] <= m[2] && b[1] >= m[1] && b[3] <= m[3]);
  if (bs.length === 0) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])),
    Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}

/** Une ligne `libellé … valeur` de la bulle (`CarteCampagne.tsx:299-300`), par `textContent`. */
function ligneBulle(doc: Document, a: string, b: string): HTMLElement {
  const d = doc.createElement('div');
  d.className = 'flex justify-between gap-[14px]';
  const g = doc.createElement('span');
  g.className = 'text-tertiary';
  g.textContent = a;
  const v = doc.createElement('span');
  v.className = 'font-mono';
  v.textContent = b;
  d.append(g, v);
  return d;
}

/**
 * La bulle d'une entité survolée (`CarteCampagne.tsx:302-332`) — par `textContent`, jamais par `setHTML` : les noms de
 * bassins sont ÉDITABLES (`zone_set_clusters.nom`), donc saisis par un utilisateur.
 */
export function contenuBulleCampagne(
  couche: string, p: Record<string, unknown>, zones: readonly LigneZone[], doc: Document = document,
): HTMLElement | null {
  const racine = doc.createElement('div');
  racine.className = 'flex flex-col gap-0.5 text-[11px] text-primary';
  const titre = (texte: string) => {
    const s = doc.createElement('strong');
    s.className = 'font-semibold';
    s.textContent = texte;
    return s;
  };
  if (couche === L_BASSINS) {
    const z = zones.find((x) => x.id === p['id']);
    if (!z) return null;
    racine.append(
      titre(z.nom),
      ligneBulle(doc, 'Sites', formaterNombre(z.n_sites)),
      ligneBulle(doc, 'Exposés', formaterNombre(z.pop_exposee)),
      ligneBulle(doc, 'Part du plan', `${formaterDecimal(z.part_plan * 100, 1)} %`),
      ligneBulle(doc, 'Part diffusée', `${formaterDecimal(z.part_diffusee * 100, 1)} %`),
      ligneBulle(doc, 'Indice', z.indice == null ? '—' : String(Math.round(z.indice))),
      ligneBulle(doc, 'Impressions', formaterNombre(Math.round(z.impressions))),
      ligneBulle(doc, 'dont utiles', formaterNombre(Math.round(z.utiles))),
    );
  } else if (couche === L_CERCLES) {
    racine.append(
      titre(String(p['codes'] ?? '')),
      ligneBulle(doc, 'Impressions', formaterNombre(Number(p['imps']))),
      ligneBulle(doc, 'Statut', p['achete'] ? 'acheté en zone' : 'fuite hors plan'),
    );
  } else if (couche === L_SITES) {
    racine.append(titre(String(p['nom'] ?? 'Site')));
    if (p['ville']) {
      const v = doc.createElement('div');
      v.textContent = String(p['ville']);
      racine.append(v);
    }
  } else {
    racine.append(
      titre(String(p['code_postal'] ?? '')),
      ligneBulle(doc, 'Impressions', formaterNombre(Number(p['imps']))),
      ligneBulle(doc, 'Indice', p['indice_cp'] == null ? '—' : String(Math.round(Number(p['indice_cp'])))),
    );
  }
  return racine;
}

/** Les six bornes de la légende, sous les sept tranches (`CarteCampagne.tsx:386`). */
export const BORNES_LEGENDE = ['50', '75', '90', '110', '125', '150'];

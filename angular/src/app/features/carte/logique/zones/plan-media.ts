import type { CibleKey } from './cibles';
import { proportionalShares } from './media-plan';

/**
 * Les calculs du plan média des zones affichées — extraits de `app/map/_components/ZoneMediaPlanPanel.tsx` (lot 4,
 * T15), où ils vivaient dans le composant. Formules, arrondis et formats RECOPIÉS tels quels : la parité se juge
 * cellule par cellule contre l'écran React, et un arrondi déplacé suffit à changer un chiffre.
 *
 * Les deux fonctions de répartition (`normalizeShares`, `proportionalShares`) restent dans `media-plan.ts`, copie
 * verbatim de `lib/custom-geo/media-plan.ts` verrouillée contre React.
 */

/** Les valeurs d'audience d'une ligne, à plat par clé de cible (`RowValues`). */
export type ValeursLigne = Partial<Record<CibleKey, number>>;

/** Une ligne du tableau : un item d'une zone (`zoneId:poiId`) ou, en repli, la zone entière (`zoneId`). */
export interface LignePlan {
  id: string;
  name: string;
  values: ValeursLigne | null;
}

/** Un item tel que `GET /api/custom-geo/[id]/items-audience` le rend (`ZoneItemStats`). */
export interface ItemAudience {
  poi_id: string;
  poi_name: string;
  values: ValeursLigne | null;
}

/** Une zone affichée, telle que le plan média la reçoit (`ZoneRef`). */
export interface ZonePlan {
  id: string;
  name: string;
}

/** Ce que le calcul rend pour une ligne (`rowMetrics`). */
export interface MetriquesLigne {
  vol: number | null;
  share: number;
  impressions: number | null;
  pctZones: number | null;
  pctFrance: number | null;
  frequence: number | null;
  costPerMille: number | null;
}

/** Le plan calculé : ce que le tableau, son pied, l'enregistrement et les exports lisent. */
export interface Plan {
  /** La répartition en vigueur : la saisie, ou le prorata du volume cible (`activeRepartition`). */
  repartition: Record<string, number>;
  totalVolume: number;
  /** Budget ÷ CPM × 1000, `null` tant que l'un des deux n'est pas un nombre positif. */
  impressionsTotales: number | null;
  /** La population France de la cible (`nationalTotals[cible]`), `null` sans totaux. */
  franceTotal: number | null;
  metriques: Map<string, MetriquesLigne>;
}

/** `items-audience` → une ligne par item ; `null` si la zone n'est pas décomposable (aucun item). */
export function lignesDesItems(zoneId: string, items: readonly ItemAudience[] | null | undefined): LignePlan[] | null {
  if (!items?.length) return null;
  return items.map((it) => ({ id: `${zoneId}:${it.poi_id}`, name: it.poi_name, values: it.values ?? null }));
}

/** Les parties d'`audience_stats` que le repli lit (`AudienceStats`, `types/custom-geo.ts`). */
interface StatsAudience {
  population?: { total: number; by_age: Record<string, number> };
  menages?: { total?: number; proprietaires?: number; monoparentales?: number; pauvres?: number };
  logements?: { sociaux?: number };
}

/**
 * Repli sur la zone entière (`ZoneMediaPlanPanel.tsx:124-138`) : `audience_stats` de la capture, aplati par clé de
 * cible. Une capture sans `population` (objet vide, calcul sauté) ne donne aucune valeur : la ligne affiche « n/d ».
 */
export function ligneZoneEntiere(zone: ZonePlan, audience: unknown): LignePlan {
  const stats = audience && typeof audience === 'object' && 'population' in audience ? (audience as StatsAudience) : null;
  const values: ValeursLigne | null = stats?.population ? {
    total: stats.population.total,
    ...stats.population.by_age,
    men: stats.menages?.total,
    men_prop: stats.menages?.proprietaires,
    men_fmp: stats.menages?.monoparentales,
    men_pauv: stats.menages?.pauvres,
    log_soc: stats.logements?.sociaux,
  } : null;
  return { id: zone.id, name: zone.name, values };
}

/** Lecture d'un champ « Budget » ou « CPM » : virgule décimale admise, `parseFloat` comme React (« 10 000 » vaut 10). */
export function lireMontant(texte: string): number {
  return parseFloat(texte.replace(',', '.'));
}

/** Un montant envoyé : nombre positif, `null` sinon (`Number.isFinite(x) && x > 0 ? x : null`). */
export function montantRetenu(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Poids arrondi au dixième, comme les poids enregistrés et exportés (`Math.round(x * 10) / 10`). */
export function poidsArrondi(n: number): number {
  return Math.round(n * 10) / 10;
}

/** L'entrée du calcul : tout ce que `ZoneMediaPlanPanel` lit dans son état. */
export interface EntreePlan {
  lignes: readonly LignePlan[];
  cible: CibleKey;
  /** La répartition saisie, `null` tant que l'utilisateur n'y a pas touché (prorata). */
  repartition: Record<string, number> | null;
  budget: number;
  cpm: number;
  totaux: Record<string, number> | null;
}

/** Les volumes, le prorata, les impressions et les métriques par ligne (`ZoneMediaPlanPanel.tsx:197-252`). */
export function calculerPlan(e: EntreePlan): Plan {
  const volumes = new Map<string, number | null>();
  for (const r of e.lignes) volumes.set(r.id, r.values ? (r.values[e.cible] ?? null) : null);
  const totalVolume = e.lignes.reduce((acc, r) => acc + (volumes.get(r.id) ?? 0), 0);
  const repartition = e.repartition ?? proportionalShares(e.lignes.map((r) => ({ id: r.id, volume: volumes.get(r.id) ?? null })));
  const impressionsTotales = e.budget > 0 && e.cpm > 0 ? (e.budget / e.cpm) * 1000 : null;
  const franceTotal = e.totaux?.[e.cible] ?? null;

  const metriques = new Map<string, MetriquesLigne>();
  for (const r of e.lignes) {
    const vol = volumes.get(r.id) ?? null;
    const share = repartition[r.id] ?? 0;
    const impressions = impressionsTotales != null ? (share / 100) * impressionsTotales : null;
    const budgetLigne = Number.isFinite(e.budget) && e.budget > 0 ? (share / 100) * e.budget : null;
    metriques.set(r.id, {
      vol, share, impressions,
      pctZones: totalVolume > 0 && vol != null ? (vol / totalVolume) * 100 : null,
      pctFrance: franceTotal && vol != null ? (vol / franceTotal) * 100 : null,
      frequence: impressions != null && vol && vol > 0 ? impressions / vol : null,
      costPerMille: budgetLigne != null && vol && vol > 0 ? budgetLigne / (vol / 1000) : null,
    });
  }
  return { repartition, totalVolume, impressionsTotales, franceTotal, metriques };
}

/** `fmtInt` : entier arrondi, milliers à la française. */
export function formaterEntier(n: number): string {
  return Math.round(n).toLocaleString('fr-FR');
}

/** `fmtPct` : « 75,0 % » (un chiffre par défaut). */
export function formaterPct(n: number, chiffres = 1): string {
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres })} %`;
}

/** `fmtFreq` : « 4,5× », tiret sans valeur. */
export function formaterRepetition(n: number | null): string {
  return n != null ? `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}×` : '—';
}

/** `fmtEur` : « 23 € », tiret sans valeur. */
export function formaterEuros(n: number | null): string {
  return n != null ? `${Math.round(n).toLocaleString('fr-FR')} €` : '—';
}

/** « Enregistré le 10 oct., 14:34 » (`ZoneMediaPlanPanel.tsx:468`). */
export function dateEnregistrement(iso: string): string {
  return `Enregistré le ${new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

/** Au-delà de 10 vues par personne, la répétition s'affiche en avertissement (`ZoneMediaPlanPanel.tsx:553`). */
const SEUIL_SUR_EXPOSITION = 10;

/** Une ligne du tableau, déjà formatée : le gabarit n'appelle aucune fonction. */
export interface CelluleLigne {
  id: string;
  nom: string;
  pctZones: string;
  pctFrance: string;
  volume: string;
  /** Volume absent : « n/d » et l'infobulle « Stats d'audience non calculées pour cette zone ». */
  volumeAbsent: boolean;
  impressions: string;
  repetition: string;
  surExposition: boolean;
  cout: string;
  /** La part affichée dans le champ, au dixième. */
  part: number;
}

/** Les cellules de chaque ligne (`ZoneMediaPlanPanel.tsx:538-574`). */
export function cellulesPlan(lignes: readonly LignePlan[], plan: Plan): CelluleLigne[] {
  return lignes.map((r) => {
    const m = plan.metriques.get(r.id)!;
    return {
      id: r.id,
      nom: r.name,
      pctZones: m.pctZones != null ? formaterPct(m.pctZones) : '—',
      pctFrance: m.pctFrance != null ? formaterPct(m.pctFrance, 2) : '—',
      volume: m.vol != null ? formaterEntier(m.vol) : 'n/d',
      volumeAbsent: m.vol == null,
      impressions: m.impressions != null ? formaterEntier(m.impressions) : '—',
      repetition: formaterRepetition(m.frequence),
      surExposition: m.frequence != null && m.frequence > SEUIL_SUR_EXPOSITION,
      cout: formaterEuros(m.costPerMille),
      part: poidsArrondi(m.share),
    };
  });
}

/** Le pied du tableau, formaté (`ZoneMediaPlanPanel.tsx:576-591`). */
export interface CelluleTotal {
  pctZones: string;
  pctFrance: string;
  volume: string;
  impressions: string;
  repetition: string;
  cout: string;
  repartition: string;
}

/**
 * Le pied du tableau. La somme de la répartition additionne TOUTES les clés de la répartition en vigueur, comme React
 * (`Object.values(activeRepartition)`) : un poids enregistré pour une ligne absente y compte encore.
 */
export function celluleTotal(plan: Plan, budget: number): CelluleTotal {
  const { totalVolume: tv, impressionsTotales: ti, franceTotal: ft } = plan;
  return {
    pctZones: tv > 0 ? '100 %' : '—',
    pctFrance: ft && tv > 0 ? formaterPct((tv / ft) * 100, 2) : '—',
    volume: tv > 0 ? formaterEntier(tv) : '—',
    impressions: ti ? formaterEntier(ti) : '—',
    repetition: formaterRepetition(ti && tv > 0 ? ti / tv : null),
    cout: formaterEuros(budget > 0 && tv > 0 ? budget / (tv / 1000) : null),
    repartition: formaterPct(Object.values(plan.repartition).reduce((a, b) => a + b, 0), 0),
  };
}

/** Les champs communs à l'enregistrement et à l'instantané. */
interface EntreeEnvoi {
  campagne: string;
  zones: readonly ZonePlan[];
  lignes: readonly LignePlan[];
  plan: Plan;
  budget: number;
  cpm: number;
  cible: CibleKey;
}

/** `POST /api/custom-geo/media-plan` : le plan rattaché à la campagne (`savePlan`, `ZoneMediaPlanPanel.tsx:320-334`). */
export function corpsPlan(e: EntreeEnvoi) {
  return {
    campaign_id: e.campagne,
    plan: {
      zones: e.zones,
      budget: montantRetenu(e.budget),
      cpm: montantRetenu(e.cpm),
      cible: e.cible,
      weights: Object.fromEntries(e.lignes.map((r) => [r.id, poidsArrondi(e.plan.repartition[r.id] ?? 0)])),
    },
  };
}

/** Les lignes d'items d'une zone (`r.id.startsWith('<zoneId>:')`). */
function itemsDeZone(zoneId: string, lignes: readonly LignePlan[]): LignePlan[] {
  return lignes.filter((r) => r.id.startsWith(`${zoneId}:`));
}

/**
 * Les poids d'export d'une zone, par item (clé sans le préfixe de zone), BRUTS — non renormalisés, les scores DSP
 * sont relatifs (`ZoneMediaPlanPanel.tsx:265-270`). `null` : zone non décomposable, export classique non pondéré.
 */
export function poidsDesItems(zoneId: string, lignes: readonly LignePlan[], repartition: Record<string, number>): Record<string, number> | null {
  const items = itemsDeZone(zoneId, lignes);
  if (!items.length) return null;
  return Object.fromEntries(items.map((r) => [r.id.slice(zoneId.length + 1), poidsArrondi(repartition[r.id] ?? 0)]));
}

/**
 * `POST /api/custom-geo/media-plan/snapshot` : le plan poussé, figé pour le suivi plan-vs-réel
 * (`ZoneMediaPlanPanel.tsx:281-306`). Seules les zones décomposables y entrent ; `null` s'il n'en reste aucune.
 */
export function corpsInstantane(e: EntreeEnvoi & { format: 'bidding_script' | 'tiktok_geo' }) {
  const zones = e.zones.map((z) => ({
    zone_id: z.id,
    zone_name: z.name,
    items: itemsDeZone(z.id, e.lignes).map((r) => ({ item_id: r.id, item_name: r.name, weight: poidsArrondi(e.plan.repartition[r.id] ?? 0) })),
  })).filter((z) => z.items.length > 0);
  if (!zones.length) return null;
  return {
    campaign_id: e.campagne,
    dsp: e.format === 'tiktok_geo' ? 'tiktok' : 'dv360',
    budget: montantRetenu(e.budget),
    cpm: montantRetenu(e.cpm),
    cible: e.cible,
    zones,
  };
}

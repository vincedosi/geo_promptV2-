/**
 * Liaison plateforme générique par canal (geo_strategy.channels.links).
 * La hiérarchie des niveaux (annonceur → campagne → …) vient du registre
 * `dsp_channel_registry.link_levels` — aucune hiérarchie en dur ici.
 * Chaque niveau écrit deux clés plates dans l'entrée du canal :
 * `${key}_id` et `${key}_name`. Clé d'entrée = code canal du registre
 * (dv360, tiktok, meta, ttd, cm360, adform…), rempli soit par la cascade
 * API (canal connecté), soit à la main (mode démo / connexion absente) —
 * même structure stockée dans les deux cas.
 */
import { z } from 'zod';

/** Un niveau de liaison du registre (du plus haut au plus bas). */
export interface LinkLevel { key: string; label: string }

/** Entrée d'un canal : map plate `${key}_id` / `${key}_name` (+ extras, ex. algorithm_id). */
export type PlatformLinks = Record<string, string | undefined>;

/** Une entrée par canal sélectionné (clé = code du registre). */
export type DspLinks = Record<string, PlatformLinks | undefined>;

/** Compat DV360 (cascade API, push bidding) — même forme plate que PlatformLinks. */
export type Dv360Links = {
  advertiser_id?: string;
  advertiser_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  insertion_order_id?: string;
  insertion_order_name?: string;
  algorithm_id?: string;
};

export const PlatformLinksSchema = z.record(
  z.string().min(1).max(60),
  z.string().max(200),
);

export const DspLinksSchema = z.record(
  z.string().min(1).max(50),
  PlatformLinksSchema,
);

function hasContent(entry: PlatformLinks | undefined): boolean {
  return !!entry && Object.values(entry).some((v) => typeof v === 'string' && v.trim() !== '');
}

/**
 * Garde uniquement les liaisons des canaux encore sélectionnés
 * (dsps + socials + ad_server) et purge les entrées vides —
 * même rôle que pruneBudgets au retrait d'un canal.
 */
export function pruneLinks(
  links: DspLinks | null | undefined,
  sel: { dsps: string[]; socials: string[]; ad_server: string | null },
): DspLinks {
  if (!links) return {};
  const allowed = new Set([...sel.dsps, ...sel.socials, ...(sel.ad_server ? [sel.ad_server] : [])]);
  return Object.fromEntries(
    Object.entries(links).filter(([code, entry]) => allowed.has(code) && hasContent(entry)),
  );
}

/** true si chaque niveau du canal a un ID renseigné (liaison exploitable). */
export function linksComplete(entry: PlatformLinks | undefined, levels: LinkLevel[]): boolean {
  if (levels.length === 0) return false;
  return levels.every((l) => !!entry?.[`${l.key}_id`]?.trim());
}

/** Résumé lisible « Nom → Nom → … » des niveaux renseignés (fallback ID). */
export function linksSummary(entry: PlatformLinks | undefined, levels: LinkLevel[]): string {
  if (!entry) return '';
  return levels
    .map((l) => entry[`${l.key}_name`]?.trim() || entry[`${l.key}_id`]?.trim() || '')
    .filter((s) => s !== '')
    .join(' → ');
}

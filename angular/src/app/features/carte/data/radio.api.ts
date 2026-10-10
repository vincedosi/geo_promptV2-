import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Une radio du filtre multi-radios (`radios_with_emetteurs` de `get_radio_filter_options`). */
export interface RadioOption {
  id: string;
  nom: string;
  cat: string | null;
}

/** Les options du filtre, telles que la page les garde (`RadioFilterOptions`, `useRadioLayer.ts:26-29`). */
export interface OptionsFiltreRadio {
  radios: RadioOption[];
  categories: Array<{ value: string; label: string }>;
}

/** Ce que rend `GET /api/radio/filter-options` (`get_radio_filter_options`, jsonb). */
export interface ReponseOptionsRadio {
  categories?: Array<{ value: string; label: string }> | null;
  radios_with_emetteurs?: RadioOption[] | null;
}

/** Une station de l'autocomplétion (`RadioSearchInput.tsx:10`). */
export interface StationRadio {
  id: string;
  nom: string;
  categorie_arcom: string | null;
}

/**
 * Les trois stratégies de chargement des émetteurs (`useRadioLayer.ts:84-103`), dans l'ordre de priorité de React :
 * une radio choisie (tous ses émetteurs, sans bbox), la couverture (lecture GLOBALE plafonnée à 15 000, sans bbox — un
 * cercle de 54 km déborde de l'écran), sinon la carte visible.
 */
export interface RequeteEmetteurs {
  radioId: string | null;
  couverture: boolean;
  /** La carte visible `[ouest, sud, est, nord]` : employée seulement sans radio choisie ni couverture. */
  bbox: readonly [number, number, number, number];
  systeme: string;
  radioIds: readonly string[];
  categoriesExclues: readonly string[];
}

/** Plafond de la lecture globale du mode couverture (`useRadioLayer.ts:94`) ; 12 704 émetteurs en base (2026-10-10). */
export const LIMITE_COUVERTURE = 15000;

/**
 * La chaîne de requête de `/api/radio/emetteurs`, OCTET POUR OCTET celle de React : `URLSearchParams`, dans le même
 * ordre (`radio_id` | `limit` | `bbox`, puis `systeme`, `radio_ids`, `exclude_categories`), bbox à 4 décimales.
 */
export function parametresEmetteurs(r: RequeteEmetteurs): string {
  const p = new URLSearchParams();
  if (r.radioId) p.set('radio_id', r.radioId);
  else if (r.couverture) p.set('limit', String(LIMITE_COUVERTURE));
  else p.set('bbox', r.bbox.map((v) => v.toFixed(4)).join(','));
  if (r.systeme) p.set('systeme', r.systeme);
  if (r.radioIds.length > 0) p.set('radio_ids', r.radioIds.join(','));
  if (r.categoriesExclues.length > 0) p.set('exclude_categories', r.categoriesExclues.join(','));
  return p.toString();
}

/**
 * Les émetteurs radio FM/DAB+ de la carte principale (`useRadioLayer.ts`, `RadioSearchInput.tsx`).
 *
 * ── RÈGLES D'I/O (CLAUDE.md § Disk I/O) ─────────────────────────────────
 * - Rien au chargement de la page : les émetteurs partent du bouton « Afficher les émetteurs », les options du filtre
 *   de la PREMIÈRE visibilité, UNE fois par écran (`RadioService`, cache avant appel).
 * - Les deux routes de lecture appellent des RPC `RETURNS jsonb` : ni la troncature à 5 000 des RPC tabulaires ni le
 *   `db-max-rows` (1 000) des requêtes de table ne les coupent (vérifié le 2026-10-10 : 12 704 émetteurs servis).
 * - L'autocomplétion attend 300 ms et deux caractères, 8 résultats au plus (`RadioSearchInput.tsx:14-20`).
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`), comme tout service d'API (garde `modele-aida.test.ts`).
 */
@Injectable()
export class RadioApi extends HttpBaseService {
  /** `GET /api/radio/emetteurs?…` — un GeoJSON de points. */
  emetteurs(r: RequeteEmetteurs): Observable<GeoJSON.FeatureCollection> {
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/radio/emetteurs?${parametresEmetteurs(r)}`);
  }

  /** `GET /api/radio/filter-options` — catégories et radios ayant au moins un émetteur. */
  optionsFiltre(): Observable<ReponseOptionsRadio> {
    return this.httpClient.get<ReponseOptionsRadio>(`${this.baseUrl}/radio/filter-options`);
  }

  /** `GET /api/radio/stations?search=…&limit=8` (`RadioSearchInput.tsx:17`). */
  stations(recherche: string): Observable<{ stations?: StationRadio[] }> {
    return this.httpClient.get<{ stations?: StationRadio[] }>(
      `${this.baseUrl}/radio/stations?search=${encodeURIComponent(recherche)}&limit=8`,
    );
  }
}

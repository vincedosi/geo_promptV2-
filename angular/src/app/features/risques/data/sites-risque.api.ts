import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/sites/compter (app/api/risques/sites/compter/route.ts). */
export interface CompteSites {
  /** Sites retenus par les filtres. */
  retenus: number;
  /** Sites du même périmètre, sans filtre de risque. */
  total: number;
  par_nature: Record<string, number>;
}

/** Filtres de `compter` — mêmes champs que `use-sites-compte.ts`. */
export interface FiltresCompte {
  gravites?: string[];
  natures?: string[];
  perimNiveau?: 'region' | 'departement' | null;
  perimCode?: string | null;
}

/**
 * Filtres de `carte` — ce que `RisqueIndustrielLayer.tsx:256-270` pose dans l'adresse (lot 4, T12). `natures` : les
 * LIBELLÉS de nature déjà résolus depuis les types de risque (`librellesDuType` + « Nature non précisée »).
 */
export interface FiltresCarteRisque {
  gravites: readonly string[];
  natures: readonly string[];
  inclureInactifs: boolean;
  /** 0 = aucune zone calculée. */
  rayonM: number;
  /** Absente = défaut de la route (2 000). React n'en envoie jamais. */
  limite?: number;
}

/** Réponse de GET /api/map/risques-industriels (`app/api/map/risques-industriels/route.ts:69-81`). */
export interface CollectionSitesRisque {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, unknown>;
  }>;
  /** Compté AVANT la limite (la limite coupe les sites les MOINS graves d'abord). */
  n_total?: number;
  n_rendus?: number;
  n_avec_pprt?: number;
}

/** Un palier de population exposée (`GET /api/risques/[siteId]/exposition`). */
export interface PalierExposition {
  palier: string;
  libelle: string;
  pop_exposee: number;
  pop_couronne: number;
}

/** Réponse de `exposition` : `indicatif` = rayon choisi par nous (true) ou servitude PPRT de l'État (false). */
export interface ExpositionSite {
  mode?: 'pprt' | 'buffer';
  indicatif?: boolean;
  paliers?: PalierExposition[];
  error?: string;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class SitesRisqueApi extends HttpBaseService {
  /**
   * Paramètres posés comme `use-sites-compte.ts:57-65` : `gravites` et
   * `natures` seulement s'ils sont non vides, `perim_niveau` + `perim_codes`
   * seulement ensemble.
   */
  compter(f: FiltresCompte = {}): Observable<CompteSites> {
    let params = new HttpParams();
    const gravites = (f.gravites ?? []).join(',');
    const natures = (f.natures ?? []).join(',');
    if (gravites) params = params.set('gravites', gravites);
    if (natures) params = params.set('natures', natures);
    if (f.perimNiveau && f.perimCode) {
      params = params.set('perim_niveau', f.perimNiveau).set('perim_codes', f.perimCode);
    }
    return this.httpClient.get<CompteSites>(`${this.baseUrl}/risques/sites/compter`, { params });
  }

  /**
   * Les sites ICPE de la carte VISIBLE pour la couche « Zones à risque industriel » de la carte principale (lot 4, T12) —
   * `GET /api/map/risques-industriels`, paramètres dans l'ordre de `RisqueIndustrielLayer.tsx:258-270` : `bbox`,
   * `gravites`, `inclure_inactifs` (`1`/`0`), puis `natures` et `rayon_m` seulement s'ils portent quelque chose.
   * Réponse `jsonb` (RPC `risques_industriels_carte`) : aucune troncature PostgREST, la borne est `limite`.
   */
  carte(bbox: string, f: FiltresCarteRisque): Observable<CollectionSitesRisque> {
    let params = new HttpParams()
      .set('bbox', bbox)
      .set('gravites', f.gravites.join(','))
      .set('inclure_inactifs', f.inclureInactifs ? '1' : '0');
    if (f.natures.length > 0) params = params.set('natures', f.natures.join(','));
    if (f.rayonM > 0) params = params.set('rayon_m', String(f.rayonM));
    if (f.limite !== undefined) params = params.set('limite', String(f.limite));
    return this.httpClient.get<CollectionSitesRisque>(`${this.baseUrl}/map/risques-industriels`, { params });
  }

  /** Population exposée d'un site (`RisqueIndustrielLayer.tsx:128`), identifiant encodé comme React. */
  exposition(siteId: string): Observable<ExpositionSite> {
    return this.httpClient.get<ExpositionSite>(`${this.baseUrl}/risques/${encodeURIComponent(siteId)}/exposition`);
  }
}

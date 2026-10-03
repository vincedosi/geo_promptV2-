import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';

/** Réponse de GET /api/risques/exposition/rayon (app/api/risques/exposition/rayon/route.ts). */
export interface ReponseCourbe {
  rayon_max_m: number;
  n_sites: number;
  /** Départements où se trouvent les sites retenus (sous-titre du KPI « sites concernés »). */
  n_departements: number;
  courbes: { cle: string; total: number; points: { r: number; p: number; i: number }[] }[];
}

/** Filtres de `courbe` (`use-courbe-rayon.ts:106-120`). */
export interface FiltresCourbe {
  cible?: string;
  natures?: string[];
  perimNiveau?: string | null;
  perimCode?: string | null;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts) et non à la
// racine : un service racine recevrait le HttpClient de l'hôte, sans nos
// intercepteurs (jeton, limiteur, session expirée).
@Injectable()
export class ZonesRisqueApi extends HttpBaseService {
  /**
   * Construit (ou retrouve) la géométrie des zones d'un profil, AVANT d'allumer
   * les tuiles. Le PROFIL seul dans `profil`, les natures à part et seulement si
   * non vides : le serveur recompose la clé de cache (`CarteRisque.tsx:528-540`).
   */
  preparer(codeProfil: string, natures: string[] = []): Observable<unknown> {
    const corps: { profil: string; natures?: string[] } = { profil: codeProfil };
    if (natures.length > 0) corps.natures = natures;
    return this.httpClient.post(`${this.baseUrl}/risques/zones/preparer`, corps);
  }

  /**
   * Modèle d'adresse des tuiles MVT des zones d'un profil (absolue, `{z}/{x}/{y}`
   * laissés à MapLibre). `natures=` en suffixe seulement si non vide, encodé
   * comme `CarteRisque.tsx:396` (`encodeURIComponent` de la liste jointe).
   */
  urlTuilesZones(codeProfil: string, natures: string[] = []): string {
    const cleNatures = natures.join(',');
    return `${this.urlAbsolue('tiles/zones-risque/{z}/{x}/{y}')}?profil=${encodeURIComponent(codeProfil)}`
      + (cleNatures ? `&natures=${encodeURIComponent(cleNatures)}` : '');
  }

  /** Sites de la bbox visible — jamais sans bbox (règle I/O de CLAUDE.md). Ordre de `CarteRisque.tsx:572-575`. */
  sites(bbox: string, f: { gravites?: string[]; natures?: string[] } = {}): Observable<GeoJSON.FeatureCollection> {
    let params = new HttpParams().set('bbox', bbox).set('limite', '800');
    const gravites = (f.gravites ?? []).join(',');
    const natures = (f.natures ?? []).join(',');
    if (gravites) params = params.set('gravites', gravites);
    if (natures) params = params.set('natures', natures);
    return this.httpClient.get<GeoJSON.FeatureCollection>(`${this.baseUrl}/map/risques-industriels`, { params });
  }

  /** Ordre de `use-courbe-rayon.ts:109-117` : cible, gravites, natures, perim_niveau, perim_codes. */
  courbe(gravites: string, f: FiltresCourbe = {}): Observable<ReponseCourbe> {
    let params = new HttpParams();
    if (f.cible) params = params.set('cible', f.cible);
    if (gravites) params = params.set('gravites', gravites);
    const natures = (f.natures ?? []).join(',');
    if (natures) params = params.set('natures', natures);
    if (f.perimNiveau && f.perimCode) {
      params = params.set('perim_niveau', f.perimNiveau).set('perim_codes', f.perimCode);
    }
    return this.httpClient.get<ReponseCourbe>(`${this.baseUrl}/risques/exposition/rayon`, { params });
  }
}

import { HttpParams, type HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { JeuDeZones } from '../logique/jeu';

/** Une ligne de la bibliothèque (`use-jeux-zones.ts:40-52`). */
export interface JeuResume {
  id: string;
  nom: string;
  description: string | null;
  version: number;
  created_at: string;
  construit_le: string | null;
  population_exposee: number | null;
  n_cp_retenus: number | null;
  taux_utile: number | null;
  mode_plan: string;
  seuil_couverture_cp: number;
}

/** Ce qu'une classe pèse dans un jeu construit (`use-jeux-zones.ts:67-83`). */
export interface ClasseJeu {
  classe: string;
  n_cp: number;
  n_cp_retenus: number;
  population_en_zone: number;
  /** Numérateur du taux d'utile — jamais `population_en_zone`. */
  population_en_zone_retenue: number;
  population_achetee: number;
}

/** Le détail d'un jeu construit, brouillon compris (`use-jeux-zones.ts:86-95`). */
export interface JeuDetail {
  jeu: JeuResume & {
    brouillon: boolean;
    profil: unknown;
    profil_hash: string;
    poids: Record<string, number>;
  };
  classes: ClasseJeu[];
}

/** Champs réglables par PATCH (`use-jeux-zones.ts:117-124`). */
export interface ReglageJeu {
  nom?: string;
  description?: string | null;
  mode_plan?: 'pondere' | 'exclusif';
  seuil_couverture_cp?: number;
  poids?: Record<string, number>;
  enregistrer?: boolean;
}

/** Réponse de GET …/cp-geo (`CarteCodesPostaux.tsx:105-113`). */
export interface ChargementCp {
  type: 'FeatureCollection';
  features: { properties: Record<string, unknown> }[];
  n_total: number;
  n_affiches: number;
  n_retenus: number;
  taux_utile: number | null;
  error?: string;
}

/** Un bassin (`TableauGrappes.tsx:25-37`). */
export interface Grappe {
  id: string;
  rang: number;
  nom: string;
  niveau_dominant: string;
  n_sites: number;
  pop_exposee: number | null;
  n_cp: number;
  n_cp_retenus: number;
  /** Les codes postaux du bassin, livrés AVEC lui (sql/230). */
  codes_postaux: string[];
  bbox: [number, number, number, number] | null;
}

/** Une extraction figée (`PanneauExtractions.tsx:35-47`). */
export interface Extraction {
  id: string;
  version: number;
  origine: 'initiale' | 'recalage';
  commentaire: string;
  seuil_couverture_cp: number;
  mode_plan: string;
  n_cp: number;
  n_retenus: number;
  taux_utile: number | null;
  part_plan_en_zone: number | null;
  created_at: string;
}

/** Corps de POST …/extractions (`PanneauExtractions.tsx:112-115`). */
export interface CorpsExtraction {
  origine?: 'initiale' | 'recalage';
  commentaire?: string | null;
}

// Fourni par la ROUTE (FOURNISSEURS_DISTANTS, app.routes.ts), jamais à la racine.
@Injectable()
export class JeuxZonesApi extends HttpBaseService {
  private url(id: string, suite = ''): string {
    return `${this.baseUrl}/zones/jeux/${id}${suite}`;
  }

  lister(): Observable<{ jeux: JeuResume[] }> {
    return this.httpClient.get<{ jeux: JeuResume[] }>(`${this.baseUrl}/zones/jeux`);
  }

  lire(id: string): Observable<JeuDetail> {
    return this.httpClient.get<JeuDetail>(this.url(id));
  }

  /** Construit un BROUILLON (21 s à froid) : `{ jeu, brouillon: true }`. */
  construire(jeu: JeuDeZones): Observable<{ id: string }> {
    return this.httpClient.post<{ id: string }>(`${this.baseUrl}/zones/jeux`, { jeu, brouillon: true });
  }

  regler(id: string, champs: ReglageJeu): Observable<unknown> {
    return this.httpClient.patch(this.url(id), champs);
  }

  supprimer(id: string): Observable<unknown> {
    return this.httpClient.delete(this.url(id));
  }

  /** Codes postaux du jeu dans le cadre visible — `bbox` obligatoire. */
  cpGeo(id: string, bbox: string): Observable<ChargementCp> {
    return this.httpClient.get<ChargementCp>(this.url(id, '/cp-geo'), { params: new HttpParams().set('bbox', bbox) });
  }

  grappes(id: string): Observable<{ grappes: Grappe[] }> {
    return this.httpClient.get<{ grappes: Grappe[] }>(this.url(id, '/grappes'));
  }

  extractions(id: string): Observable<{ extractions: Extraction[] }> {
    return this.httpClient.get<{ extractions: Extraction[] }>(this.url(id, '/extractions'));
  }

  /** Fige le plan courant. L'appelant fournit `commentaire` déjà nettoyé (React : `trim()`). */
  extraire(id: string, corps: CorpsExtraction): Observable<unknown> {
    return this.httpClient.post(this.url(id, '/extractions'), corps);
  }

  exportJeu(id: string): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(this.url(id, '/export'), { observe: 'response', responseType: 'blob' });
  }

  exportExtraction(id: string, version: number): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(this.url(id, `/extractions/${version}/export`), {
      observe: 'response', responseType: 'blob',
    });
  }
}

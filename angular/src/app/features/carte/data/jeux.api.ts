import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Extraction } from '../../risques/data/jeux-zones.api';
import type { MODES_PLAN } from '../../risques/logique/jeu';
import type { Maille, Plateforme, PlateformeGeo } from '../logique/jeu/plateformes';
import type { Recette } from '../logique/zones/recette';

/**
 * ⑤ Jeu de zones — les routes du lot 5 (T7, T8), vues de l'écran : le registre des plateformes, les jeux de ZONE
 * (enregistrer, lire, régler, supprimer, extraire), le pavage en cercles d'une zone, les contours des communes.
 * La conversion territoriale (CP, IRIS, commune, département, forme) passe par `CouvertureApi.couverture` du lot 4 :
 * aucune méthode recopiée ici.
 *
 * ⚠ RECOUVREMENT DÉCLARÉ avec `JeuxZonesApi` (module risque) : `lister`, `supprimer`, `extractions` visent les mêmes
 * adresses. Celle-là est typée pour un jeu RISQUE (classes, brouillon, seuil global) et sert un écran gelé ; celle-ci
 * pour un jeu de ZONE (zone, cible, choix par plateforme). Le type d'une extraction est partagé (`Extraction`).
 *
 * Un refus arrive en erreur HTTP avec `{ error }` (et `refus` pour une conversion) ; `messageErreurCouverture` le lit.
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine recevrait le
 * `HttpClient` du shell, sans nos intercepteurs.
 */

export type ModePlan = (typeof MODES_PLAN)[number];

/** Une ligne de `GET /api/zones/jeux` : les deux types ; `zone_nom` est `null` pour un jeu risque. */
export interface JeuListe {
  id: string;
  type: 'risque' | 'zone';
  nom: string;
  description: string | null;
  version: number;
  created_at: string;
  construit_le: string | null;
  population_exposee: number | null;
  n_cp_retenus: number | null;
  taux_utile: number | null;
  mode_plan: string;
  seuil_couverture_cp: number | null;
  custom_geo_zone_id: string | null;
  zone_nom: string | null;
}

/** Le choix d'une plateforme tel qu'il part (`ChoixPlateformeSchema`, strict) : un rayon pour le cercle, et lui seul. */
export interface ChoixPlateforme {
  plateforme: Plateforme;
  maille: Maille;
  seuil: number;
  rayon_m?: number;
}

/** Le choix tel que `zone_set_plateformes` le relit. */
export interface ChoixEnregistre {
  plateforme: Plateforme;
  maille: Maille;
  seuil: number;
  rayon_m: number | null;
}

/** `GET /api/zones/jeux/[id]` d'un jeu de ZONE (`lireJeuZone`) — et la réponse d'un PATCH. */
export interface DetailJeuZone {
  jeu: {
    id: string; type: 'zone'; nom: string; description: string | null; version: number; created_at: string;
    custom_geo_zone_id: string; cible: string; mode_plan: ModePlan;
  };
  zone: { id: string; nom: string; recette: Recette | null };
  plateformes: ChoixEnregistre[];
}

/** La même route pour un jeu RISQUE : une autre forme, sans `type` ; ⑤ ne la lit pas, il renvoie au module. */
export interface DetailJeuRisque {
  jeu: { id: string; type?: undefined };
}

export interface CorpsEnregistrement {
  nom: string;
  description?: string;
  jeu: { type: 'zone'; zone_id: string; cible: string; mode_plan: ModePlan; plateformes: ChoixPlateforme[] };
}

/** Le PATCH d'un jeu de zone : la zone et la cible ne changent pas (nouveau jeu). */
export interface CorpsReglage {
  nom?: string;
  description?: string | null;
  mode_plan?: ModePlan;
  plateformes?: ChoixPlateforme[];
}

/** Les paramètres de `GET /api/zones/[id]/cercles`. */
export interface DemandeCercles {
  cible: string;
  rayon: number;
  seuil: number;
  plateforme: Plateforme;
}

/** La réponse 200 de `GET /api/zones/[id]/cercles` (`paver_cercles`, sql/276) : seuls les cercles RETENUS. */
export interface ResultatCercles {
  zone_id: string;
  cible: string;
  rayon_m: number;
  seuil: number;
  /** Cellules hexagonales examinées — pas des territoires. */
  n_candidates: number;
  n_cercles: number;
  cercles: Array<{ lon: number; lat: number; pop_en_zone: number; pop_totale: number; part: number }>;
  population: number;
  couverte: number;
  manques: number;
  hors_zone: number;
  achetee: number;
  taux_utile: number | null;
  n_carreaux: number;
  motif_vide: 'territoire_non_carroye' | 'aucun_carreau' | 'aucune_cellule_au_seuil' | null;
}

/** `POST /api/zones/communes/contours` : un code absent du référentiel est DIT dans `manquants`. */
export interface ContoursCommunes {
  communes: Array<{ code: string; nom: string | null; geometry: GeoJSON.Geometry }>;
  manquants: string[];
}

/** La réponse de `POST …/extractions` (`creer_extraction_jeu_zone`) : 201 créée, 200 `deja_extraite`. */
export interface ExtractionCreee {
  ok: true;
  deja_extraite: boolean;
  id: string;
  version: number;
}

@Injectable()
export class JeuxApi extends HttpBaseService {
  private jeu(id: string, suite = ''): string {
    return `${this.baseUrl}/zones/jeux/${encodeURIComponent(id)}${suite}`;
  }

  plateformes(): Observable<{ plateformes: PlateformeGeo[] }> {
    return this.httpClient.get<{ plateformes: PlateformeGeo[] }>(`${this.baseUrl}/zones/plateformes`);
  }

  lister(): Observable<{ jeux: JeuListe[] }> {
    return this.httpClient.get<{ jeux: JeuListe[] }>(`${this.baseUrl}/zones/jeux`);
  }

  lire(id: string): Observable<DetailJeuZone | DetailJeuRisque> {
    return this.httpClient.get<DetailJeuZone | DetailJeuRisque>(this.jeu(id));
  }

  enregistrer(corps: CorpsEnregistrement): Observable<{ id: string; version: number }> {
    return this.httpClient.post<{ id: string; version: number }>(`${this.baseUrl}/zones/jeux`, corps);
  }

  regler(id: string, corps: CorpsReglage): Observable<DetailJeuZone> {
    return this.httpClient.patch<DetailJeuZone>(this.jeu(id), corps);
  }

  supprimer(id: string): Observable<{ ok: true; supprimes: number }> {
    return this.httpClient.delete<{ ok: true; supprimes: number }>(this.jeu(id));
  }

  cercles(zoneId: string, d: DemandeCercles): Observable<ResultatCercles> {
    const p = new URLSearchParams({ cible: d.cible, rayon: String(d.rayon), seuil: String(d.seuil), plateforme: d.plateforme });
    return this.httpClient.get<ResultatCercles>(`${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/cercles?${p.toString()}`);
  }

  /** POST et non GET : 3 000 codes ne tiennent pas dans une adresse. */
  contoursCommunes(codes: readonly string[]): Observable<ContoursCommunes> {
    return this.httpClient.post<ContoursCommunes>(`${this.baseUrl}/zones/communes/contours`, { codes });
  }

  extractions(id: string): Observable<{ extractions: Extraction[]; jeu: { id: string; nom: string; version: number } }> {
    return this.httpClient.get<{ extractions: Extraction[]; jeu: { id: string; nom: string; version: number } }>(this.jeu(id, '/extractions'));
  }

  /** Fige le jeu : le SERVEUR recalcule chaque plateforme, le corps ne porte que l'origine et le commentaire. */
  extraire(id: string, d: { commentaire: string; recalage: boolean }): Observable<ExtractionCreee> {
    return this.httpClient.post<ExtractionCreee>(this.jeu(id, '/extractions'), {
      origine: d.recalage ? 'recalage' : 'initiale', commentaire: d.commentaire,
    });
  }
}

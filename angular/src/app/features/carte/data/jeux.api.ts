import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import type { Extraction } from '../../risques/data/jeux-zones.api';
import type { MODES_PLAN } from '../../risques/logique/jeu';
import type { ResultatCercles } from '../logique/jeu/bilan';
import type { Avertissement } from '../logique/jeu/conversion';
import type { MecanismePoussee, ReglagesDefaut } from '../logique/jeu/conversion-defaut';
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

/** Une ligne de `GET /api/zones/jeux?type=tous` : les deux types ; `zone_nom` est `null` pour un jeu risque. */
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
  /** Le nombre d'extractions figées (agrégat de la liste, lot 6) : 0 = le jeu n'est pas encore utilisable en ⑥. */
  n_extractions: number;
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
    /** C29 (sql/329) ; absent d'une réponse d'avant = non. */
    categorie_speciale?: boolean;
  };
  /** `surface_km2` : sql/316 (B10), absente d'une réponse d'avant. */
  zone: { id: string; nom: string; recette: Recette | null; surface_km2?: number | null };
  plateformes: ChoixEnregistre[];
}

/** La même route pour un jeu RISQUE : une autre forme, sans `type` ; ⑤ ne la lit pas, il renvoie au module. */
export interface DetailJeuRisque {
  jeu: { id: string; type?: undefined };
}

export interface CorpsEnregistrement {
  nom: string;
  description?: string;
  jeu: { type: 'zone'; zone_id: string; cible: string; mode_plan: ModePlan; categorie_speciale?: boolean; plateformes: ChoixPlateforme[] };
}

/** Le PATCH d'un jeu de zone : la zone et la cible ne changent pas (nouveau jeu). */
export interface CorpsReglage {
  nom?: string;
  description?: string | null;
  mode_plan?: ModePlan;
  categorie_speciale?: boolean;
  plateformes?: ChoixPlateforme[];
}

/** Les paramètres de `GET /api/zones/[id]/cercles`. */
export interface DemandeCercles {
  cible: string;
  rayon: number;
  seuil: number;
  plateforme: Plateforme;
}

/**
 * Le plafond de codes de `POST /api/zones/communes/contours` (`MAX_CODES` de la route, sql/279) — une borne de COÛT de
 * la route, pas une règle de plateforme. `tests/unit/angular/conversion-paritaire.test.ts` verrouille l'égalité.
 */
export const MAX_CODES_CONTOURS = 3000;

/** `POST /api/zones/communes/contours` : un code absent du référentiel est DIT dans `manquants`. */
export interface ContoursCommunes {
  communes: Array<{ code: string; nom: string | null; geometry: GeoJSON.Geometry }>;
  manquants: string[];
}

/**
 * Le résumé FIGÉ d'une plateforme dans une extraction (`zone_set_extractions.plateformes`, sql/278) : le choix enregistré
 * (maille, seuil, rayon) et ce que le serveur a calculé. Seuls les champs que l'écran lit sont typés.
 */
export interface ResumeExtraction {
  plateforme: Plateforme;
  maille: Maille;
  seuil: number;
  rayon_m: number | null;
  exacte?: boolean;
  n_unites?: number;
  taux_utile?: number | null;
  /** Les limites de la plateforme dépassées au moment de figer (`verifierLimites`), lues par ⑦ (lot 7, A-13). */
  avertissements?: Avertissement[];
  /** Maille pays : le ciblage n'est pas confirmé pour la recette figée (« France entière », `paysAVerifier`) ; absent sinon. */
  pays_a_verifier?: true;
  /**
   * Maille polygone (A7, sql/312-313) : la forme envoyée — tolérance retenue (0 = non simplifiée), sommets et morceaux
   * avant / après, habitants de la zone perdus et habitants hors zone gagnés. Absent avant A7.
   */
  simplification?: SimplificationPolygone;
  /**
   * B14 (ARB-6, sql/319) : au-delà de `limites.max_unites` (commune, département, IRIS), la limite lue et le bilan de
   * chaque bloc (triés par part décroissante, chacun sous la limite) ; absent sans découpage.
   */
  decoupage?: { limite: number; blocs: BlocExtraction[] };
}

/** Le bilan figé d'un bloc (`BilanBloc`, `lib/zones/decoupage-blocs.ts`). */
export interface BlocExtraction {
  numero: number;
  n_unites: number;
  couverte: number;
  achetee: number;
  hors_zone: number;
  taux_utile: number | null;
  part_max: number | null;
  part_min: number | null;
  n_inconnues?: number;
}

/** Ce que l'extraction a figé de la simplification du polygone (A7). */
export interface SimplificationPolygone {
  tolerance_m: number;
  sommets_avant: number;
  morceaux_avant: number;
  sommets: number;
  morceaux: number;
  perdue: number;
  gagnee: number;
}

/** Une ligne de `GET …/extractions` : les colonnes d'une extraction, et pour un jeu de zone son résumé par plateforme. */
export interface ExtractionJeu extends Extraction {
  plateformes: ResumeExtraction[] | null;
}

/** La réponse de `POST …/extractions` (`creer_extraction_jeu_zone`) : 201 créée, 200 `deja_extraite`. */
export interface ExtractionCreee {
  ok: true;
  deja_extraite: boolean;
  id: string;
  version: number;
}

/**
 * `GET /api/zones/plateformes` : le registre `plateformes_geo`, les mécanismes de poids de toutes les mailles
 * (`plateformes_poids`, B16 : le mode de poussée du défaut) et les réglages de la maille par défaut (sql/315).
 */
export interface ReponsePlateformes {
  plateformes: PlateformeGeo[];
  /** B16 : absent (réponse d'avant B16) = aucun mécanisme lu, le mode de poussée ne lit que `poussee_branchee`. */
  poids?: MecanismePoussee[];
  reglages_defaut?: ReglagesDefaut;
}

@Injectable()
export class JeuxApi extends HttpBaseService {
  private jeu(id: string, suite = ''): string {
    return `${this.baseUrl}/zones/jeux/${encodeURIComponent(id)}${suite}`;
  }

  /** Le registre, et (B9) les réglages de la maille par défaut — absents d'une réponse d'avant sql/315 : le repli. */
  plateformes(): Observable<ReponsePlateformes> {
    return this.httpClient.get<ReponsePlateformes>(`${this.baseUrl}/zones/plateformes`);
  }

  /** `?type=tous` : sans paramètre, la route ne rend que les jeux RISQUE (la liste que ses anciens lecteurs attendent). */
  lister(): Observable<{ jeux: JeuListe[] }> {
    return this.httpClient.get<{ jeux: JeuListe[] }>(`${this.baseUrl}/zones/jeux?type=tous`);
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

  extractions(id: string): Observable<{ extractions: ExtractionJeu[]; jeu: { id: string; nom: string; version: number } }> {
    return this.httpClient.get<{ extractions: ExtractionJeu[]; jeu: { id: string; nom: string; version: number } }>(this.jeu(id, '/extractions'));
  }

  /** Fige le jeu : le SERVEUR recalcule chaque plateforme, le corps ne porte que l'origine et le commentaire. */
  extraire(id: string, d: { commentaire: string; recalage: boolean }): Observable<ExtractionCreee> {
    return this.httpClient.post<ExtractionCreee>(this.jeu(id, '/extractions'), {
      origine: d.recalage ? 'recalage' : 'initiale', commentaire: d.commentaire,
    });
  }
}

import type { HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../core/http/http-base.service';
import { lignesNdjson } from '../../../core/http/ndjson';
import type { FormatFichier } from '../logique/activation/cartes';
import type { Plateforme } from '../logique/jeu/plateformes';

/**
 * ⑦ Activation — les routes de l'étape vues de l'écran (lot 7, T3), typées d'après les routes LUES :
 * `app/api/campaigns/[campaignId]/activation/{prevol,historique,pousser,rollback}`, `…/bidding/strategies/[id]/publier`
 * et `…/zones/jeux/[id]/extractions/[version]/fichier`. Seuls les champs que ⑦ lit sont typés.
 *
 * Fourni par la ROUTE (`FOURNISSEURS_DISTANTS`, `app.routes.ts`), jamais à la racine : un service racine recevrait le
 * `HttpClient` du shell, sans nos intercepteurs.
 */

/** Les codes des motifs du pré-vol (`lib/campaigns/activation.ts`, `motifsPrevol`). */
export type CodeMotif =
  | 'aucune_strategie' | 'droit' | 'jamais_publiee' | 'derive'
  | 'aucune_connexion' | 'connexion_en_erreur' | 'aucun_cp_dv360';

/** Une raison de ne pas pousser : un code (E4), le message du serveur, la version publiée pour `derive`. */
export interface MotifPrevol {
  code: CodeMotif | string;
  message: string;
  version?: number;
}

/** `reel` : connexion DV360 active ; `simule` : démo sans connexion ; `indisponible` : ni l'un ni l'autre (A-3). */
export type ModeDv360 = 'reel' | 'simule' | 'indisponible';

/** `GET …/activation/prevol`. */
export interface Prevol {
  strategie: { id: string; nom: string; statut: string; scope: string; zone_id: string | null;
               cpm_previsionnel: number | null; budget: number | null } | null;
  version_publiee: number | null;
  zones_modifiees: string[];
  n_codes_postaux: number;
  canaux_connectes: { provider: string; methode: string; statut: string }[];
  mode_dv360: ModeDv360;
  /** Les CP que DV360 recevrait (ceux de la zone, ou de l'extraction du plan). */
  n_cp_dv360: number;
  extraction: { zone_set_id: string; version: number } | null;
  motifs: MotifPrevol[];
  blocages: string[];
  activable: boolean;
}

export type StatutLot = 'en_cours' | 'termine' | 'partiel' | 'echec' | 'annule';

/** Une ligne de `GET …/activation/historique` (50 au plus, la plus récente d'abord). */
export interface LotActivation {
  id: string;
  canal: string;
  version_strategie: number | null;
  statut: StatutLot | string;
  /** `reel` ou `simule` (sql/281). */
  mode: string;
  lance_le: string;
  termine_le: string | null;
  lance_par: string | null;
  /** Nombre de cibles par statut. */
  cibles: Record<string, number>;
  n_cibles: number;
}

/** Une ligne du flux NDJSON de `POST …/activation/pousser` : `debut`, une `cible` par line item (en cours puis issue), `fin`. */
export interface LigneFlux {
  etape: 'debut' | 'cible' | 'fin' | string;
  lot_id?: string;
  canal?: string;
  mode?: string;
  version_strategie?: number;
  n?: number;
  /** Porté par `debut`, `fin` et la ligne `en_cours` d'une cible ; ABSENT de ses lignes `pousse`/`echec`. */
  total?: number;
  line_item_id?: string;
  statut?: string;
  erreur?: string;
  n_geo_ids?: number;
  cp_non_resolus?: number;
  pousses?: number;
  echecs?: number;
  interrompu?: boolean;
  non_traitees?: number;
}

/** Le corps de `POST …/activation/pousser` (`CorpsSchema`) : DV360 seul canal câblé, 50 line items au plus. */
export interface CorpsPoussee {
  canal: 'dv360';
  advertiser_id: string;
  cibles: { line_item_id: string }[];
}

/** `POST …/activation/rollback` : le message dit ce qui N'A PAS été fait (rien n'est retiré du DSP). */
export interface ReponseAnnulation {
  lot_id: string;
  statut: 'annule';
  n_cibles_annulees: number;
  retire_du_dsp: false;
  message: string;
}

/** `POST /api/bidding/strategies/[id]/publier` (201). */
export interface ReponsePublication {
  id: string;
  version: number;
  publiee_le: string;
  n_zones: number;
}

@Injectable()
export class ActivationApi extends HttpBaseService {
  private campagne(id: string, suite: string): string {
    return `${this.baseUrl}/campaigns/${encodeURIComponent(id)}/activation/${suite}`;
  }

  prevol(campagne: string): Observable<Prevol> {
    return this.httpClient.get<Prevol>(this.campagne(campagne, 'prevol'));
  }

  historique(campagne: string): Observable<{ lots: LotActivation[] }> {
    return this.httpClient.get<{ lots: LotActivation[] }>(this.campagne(campagne, 'historique'));
  }

  /**
   * La poussée, lue ligne à ligne (`lignesNdjson`). Un refus avant le flux (400, 403, 404, 409) arrive en erreur HTTP
   * dont le corps est du TEXTE (`responseType: 'text'`) : `messagePoussee` le lit.
   */
  pousser(campagne: string, corps: CorpsPoussee): Observable<LigneFlux> {
    return lignesNdjson<LigneFlux>(this.httpClient.post(this.campagne(campagne, 'pousser'), corps, {
      observe: 'events', reportProgress: true, responseType: 'text',
    }));
  }

  /** Marque un lot annulé (`confirme: true`, exigé par la route) ; rien n'est retiré du DSP. */
  annuler(campagne: string, lot: string): Observable<ReponseAnnulation> {
    return this.httpClient.post<ReponseAnnulation>(this.campagne(campagne, 'rollback'), { lot_id: lot, confirme: true });
  }

  /** Publie le plan : `strategie` est l'id rendu par le pré-vol (`strategie.id`). */
  publier(strategie: string): Observable<ReponsePublication> {
    return this.httpClient.post<ReponsePublication>(`${this.baseUrl}/bidding/strategies/${encodeURIComponent(strategie)}/publier`, {});
  }

  /** L'adresse du fichier d'une plateforme pour une extraction figée (A-6). */
  urlFichier(jeu: string, version: number, plateforme: Plateforme, format: FormatFichier, bloc?: number): string {
    // B14 round 1 (I-2) : un bloc du découpage (ARB-6) ; sans lui, la route refuse une extraction découpée (422).
    const p = new URLSearchParams({ plateforme, format, ...(bloc !== undefined ? { bloc: String(bloc) } : {}) });
    return `${this.baseUrl}/zones/jeux/${encodeURIComponent(jeu)}/extractions/${version}/fichier?${p.toString()}`;
  }

  /** Le fichier lui-même, en `blob`, pour `mg-bouton-export` (Bearer et message de la route, jamais un `<a href>`). */
  fichier(jeu: string, version: number, plateforme: Plateforme, format: FormatFichier, bloc?: number): Observable<HttpResponse<Blob>> {
    return this.httpClient.get(this.urlFichier(jeu, version, plateforme, format, bloc), { observe: 'response', responseType: 'blob' });
  }
}

import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type { EtatFraicheur, NatureSource } from '../../logique/types/fraicheur';

/** Une source telle que la rend la route (`app/api/admin/fraicheur-donnees/route.ts`, `assembler`). */
export interface SourceAffichee {
  id: string;
  libelle: string;
  nature: NatureSource;
  provenance: string;
  collecte: string;
  table: string | null;
  cadenceAttendueJours: number | null;
  coutMesure: 'leger' | 'lourd';
  note: string | null;
  etat: EtatFraicheur;
  ageJours: number | null;
  nLignes: number | null;
  nEstime: boolean;
  donneeMin: string | null;
  donneeMax: string | null;
  ingestionMax: string | null;
  nonMesure: string | null;
}

/** Réponse du GET (`mesureLe` à `null` = jamais mesuré). */
export interface ReponseFraicheur {
  sources: SourceAffichee[];
  mesureLe: string | null;
  dureeMs: number | null;
}

/** Réponse du POST : la même, plus `persiste` (le relevé a-t-il pu être écrit). */
export interface ReponseMesureFraicheur extends ReponseFraicheur {
  inclureLourd?: boolean;
  persiste?: boolean;
}

/**
 * Fraîcheur des sources hors socle socio-démo — `GET`/`POST /api/admin/fraicheur-donnees`
 * (`requireAdmin`). Le GET ne mesure RIEN (relevé persisté) ; le POST mesure, le corps
 * `{ inclureLourd }` choisissant le quota (`geo:rl:fraicheur` 6/min, `geo:rl:fraicheur-lourd`
 * 1/min — 347 Mo lus sur `comptages_routiers`). Le serveur FUSIONNE le relevé : le client
 * n'en recalcule rien.
 *
 * Fourni par la route `admin` (`FOURNISSEURS_ADMIN`, C3).
 */
@Injectable()
export class FraicheurApi extends HttpBaseService {
  lire(): Observable<ReponseFraicheur> {
    return this.httpClient.get<ReponseFraicheur>(`${this.baseUrl}/admin/fraicheur-donnees`);
  }

  mesurer(inclureLourd: boolean): Observable<ReponseMesureFraicheur> {
    return this.httpClient.post<ReponseMesureFraicheur>(`${this.baseUrl}/admin/fraicheur-donnees`, { inclureLourd });
  }
}

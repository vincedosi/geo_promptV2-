import { Injectable } from '@angular/core';
import { type Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { HttpBaseService } from '../../../../core/http/http-base.service';
import type {
  ApercuEspace, MembreEspace, ReponseComptes, ReponseDonneesEspace, ReponseEspaces, ReponseSocle,
} from '../logique/types';

/** Un compte tel que le rend `GET /api/admin/users` (tableau de profils). */
export interface CompteAdmin {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  organization_id: string | null;
}

/** Une organisation telle que la rend `GET /api/admin/organizations/:id` (fiche Réglages). */
export interface OrganisationComplete {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  config: Record<string, unknown> | null;
}

/** Champs modifiables d'un espace (`PATCH /api/admin/organizations/:id`). */
export interface ChampsEspace {
  name?: string;
  description?: string | null;
  active?: boolean;
  config?: Record<string, unknown>;
}

/** Réponse de `POST /api/admin/organizations`. */
export interface EspaceCreeReponse {
  success: boolean;
  organization: { id: string };
}

/**
 * La création a réussi mais le PATCH de la description a échoué : l'espace EXISTE. Porte son
 * identifiant (la page y conduit quand même) et l'erreur d'origine.
 */
export class DescriptionNonEnregistree extends Error {
  constructor(readonly id: string, override readonly cause: unknown) {
    super('Espace créé, mais la description n\'a pas été enregistrée');
    this.name = 'DescriptionNonEnregistree';
  }
}

/**
 * Accès aux données de la page « Accès » (`admin/acces`, ex-« Espaces de travail »).
 *
 * Lectures de T3 (`/api/admin/espaces/**`) et écritures des routes d'administration existantes,
 * toutes gardées par `requireAdmin` côté serveur. `@Injectable()` SANS `providedIn`, héritier de
 * `HttpBaseService` (contrat AIDA) : fourni par la route `admin` (`FOURNISSEURS_ADMIN`), il reçoit
 * le `HttpClient` porteur de nos intercepteurs (jeton, limiteur à 3 appels, session expirée).
 *
 * Chaque identifiant est encodé dans le chemin (`encodeURIComponent`) : ce sont des UUID, mais
 * une adresse ne doit jamais dépendre de la forme d'une donnée.
 */
@Injectable()
export class EspacesApi extends HttpBaseService {
  private org(id: string): string {
    return `${this.baseUrl}/admin/organizations/${encodeURIComponent(id)}`;
  }

  private compte(userId: string): string {
    return `${this.baseUrl}/admin/users/${encodeURIComponent(userId)}`;
  }

  private espaceUrl(id: string): string {
    return `${this.baseUrl}/admin/espaces/${encodeURIComponent(id)}`;
  }

  // ── Lectures (T3) ───────────────────────────────────────────────────────────

  lister(): Observable<ReponseEspaces> {
    return this.httpClient.get<ReponseEspaces>(`${this.baseUrl}/admin/espaces`);
  }

  /** Tous les comptes, avec tous leurs espaces (vue « Tous les comptes » de la page Accès). */
  lireComptes(): Observable<ReponseComptes> {
    return this.httpClient.get<ReponseComptes>(`${this.baseUrl}/admin/espaces/comptes`);
  }

  lireSocle(): Observable<ReponseSocle> {
    return this.httpClient.get<ReponseSocle>(`${this.baseUrl}/admin/espaces/socle`);
  }

  lireDonnees(id: string): Observable<ReponseDonneesEspace> {
    return this.httpClient.get<ReponseDonneesEspace>(`${this.espaceUrl(id)}/donnees`);
  }

  lireMembres(id: string): Observable<{ membres: MembreEspace[] }> {
    return this.httpClient.get<{ membres: MembreEspace[] }>(`${this.espaceUrl(id)}/membres`);
  }

  lireApercu(id: string): Observable<ApercuEspace> {
    return this.httpClient.get<ApercuEspace>(`${this.espaceUrl(id)}/apercu`);
  }

  // ── Espaces (organisations) ─────────────────────────────────────────────────

  /**
   * `POST admin/organizations { name }`, puis — seulement s'il y a une description — `PATCH
   * admin/organizations/:id { description }` : la création n'accepte pas `description`. Deux
   * appels SÉQUENTIELS (`switchMap`), le PATCH ayant besoin de l'identifiant créé. Un POST en échec
   * remonte tel quel (`HttpErrorResponse`, 409 si le nom existe) ; un PATCH en échec remonte en
   * `DescriptionNonEnregistree`, qui porte l'identifiant de l'espace bel et bien créé.
   */
  creerEspace(nom: string, description: string | null): Observable<EspaceCreeReponse> {
    return this.httpClient.post<EspaceCreeReponse>(`${this.baseUrl}/admin/organizations`, { name: nom }).pipe(
      switchMap((r) => {
        if (!description) return of(r);
        const id = r.organization.id;
        return this.httpClient.patch(this.org(id), { description }).pipe(
          map(() => r),
          catchError((e: unknown) => throwError(() => new DescriptionNonEnregistree(id, e))),
        );
      }),
    );
  }

  lireEspace(id: string): Observable<{ organization: OrganisationComplete }> {
    return this.httpClient.get<{ organization: OrganisationComplete }>(this.org(id));
  }

  modifierEspace(id: string, champs: ChampsEspace): Observable<unknown> {
    return this.httpClient.patch(this.org(id), champs);
  }

  supprimerEspace(id: string): Observable<unknown> {
    return this.httpClient.delete(this.org(id));
  }

  // ── Membres ─────────────────────────────────────────────────────────────────

  /** Corps `{ email }` SANS `role` (E3) : ajouter un super_admin ne le rétrograde pas. */
  ajouterMembre(id: string, email: string): Observable<unknown> {
    return this.httpClient.post(`${this.org(id)}/members`, { email });
  }

  retirerMembre(id: string, userId: string): Observable<unknown> {
    return this.httpClient.delete(`${this.org(id)}/members`, { body: { userId } });
  }

  /** Le lien rendu est un secret d'usage unique : jamais journalisé. */
  lienMotDePasse(id: string, email: string): Observable<{ link: string | null }> {
    return this.httpClient.post<{ link: string | null }>(`${this.org(id)}/members/reset-password`, { email });
  }

  // ── Jeux de données ─────────────────────────────────────────────────────────

  partager(id: string, sourceId: string): Observable<unknown> {
    return this.httpClient.post(`${this.org(id)}/sources/assign`, { sourceId });
  }

  retirerPartage(id: string, sourceId: string): Observable<unknown> {
    return this.httpClient.delete(`${this.org(id)}/sources/assign`, { body: { sourceId } });
  }

  modifierJeu(sourceId: string, champs: { organization_id?: string; visibilite?: 'socle' | 'privee' }): Observable<unknown> {
    return this.httpClient.patch(`${this.baseUrl}/admin/sources/${encodeURIComponent(sourceId)}`, champs);
  }

  // ── Comptes ─────────────────────────────────────────────────────────────────

  listerComptes(): Observable<CompteAdmin[]> {
    return this.httpClient.get<CompteAdmin[]>(`${this.baseUrl}/admin/users`);
  }

  /** `setup_link` est un secret d'usage unique : affiché une fois, jamais journalisé. */
  creerCompte(c: {
    email: string;
    full_name: string | null;
    role: 'client' | 'super_admin';
    organization_id: string | null;
  }): Observable<{ id: string; email: string; setup_link: string | null }> {
    return this.httpClient.post<{ id: string; email: string; setup_link: string | null }>(`${this.baseUrl}/admin/users`, c);
  }

  modifierCompte(userId: string, champs: { role?: 'client' | 'super_admin'; full_name?: string | null }): Observable<unknown> {
    return this.httpClient.patch(this.compte(userId), champs);
  }

  remplacerEspaces(
    userId: string,
    espaces: string[],
    espaceActif: string | null,
  ): Observable<{ espaces: string[]; espace_actif: string | null }> {
    return this.httpClient.put<{ espaces: string[]; espace_actif: string | null }>(
      `${this.compte(userId)}/espaces`,
      { espaces, espace_actif: espaceActif },
    );
  }

  supprimerCompte(userId: string): Observable<unknown> {
    return this.httpClient.delete(this.compte(userId));
  }
}

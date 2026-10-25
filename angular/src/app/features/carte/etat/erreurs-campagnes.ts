import { HttpErrorResponse } from '@angular/common/http';
import { type Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { messageErreurApi } from '../../../core/http/erreurs';
import type { OrganisationsApi } from '../../session/data/organisations.api';
import type { Campagne, PlanApi } from '../data/plan.api';

/*
 * ⑥ Plan — les échecs sur les CAMPAGNES (lot 6, T2-T3), sortis de `PlanCampagneService` à la revue finale (plafond de
 * 400 lignes) : le service, le hall, le sélecteur et la section Cible les lisent ici.
 */

/**
 * Le refus de RÔLE (401/403) : `/api/admin/campaigns` reste réservé au super_admin en V1 (décision de Vincent,
 * relecture 1). Le préremplissage se TERMINE sur ce message, le paramètre reste, et rien n'est écrit.
 */
export const MESSAGE_RESERVE_ADMIN = 'La gestion des campagnes est réservée aux administrateurs.';

/** Le préremplissage a lu un 404 : campagne absente, ou d'un autre espace. */
export class CampagneIntrouvable extends Error {}
/** Le préremplissage a lu un 401/403 : le rôle ne permet pas la gestion des campagnes. */
export class AccesRefuse extends Error {}

/**
 * Un 404 = campagne absente, ou d'un autre espace (`checkCampaignAccess` des canaux rend 404, jamais 403). Un 401/403
 * (`requireAdmin` de `GET /api/admin/campaigns/[id]`) dit le RÔLE, pas l'absence : `AccesRefuse`, le paramètre reste.
 */
export function classer(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse)) return e;
  if (e.status === 404) return new CampagneIntrouvable();
  if (e.status === 401 || e.status === 403) return new AccesRefuse();
  return e;
}

/**
 * Le message d'un échec sur les CAMPAGNES (liste, création, suppression) : un refus de rôle (401/403) se dit
 * `MESSAGE_RESERVE_ADMIN`, comme au préremplissage — le hall et le sélecteur le disent, ils ne se taisent pas.
 */
export function messageErreurCampagnes(e: unknown): string {
  return classer(e) instanceof AccesRefuse ? MESSAGE_RESERVE_ADMIN : messageErreurApi(e);
}

/**
 * La campagne appartient-elle à l'ESPACE ACTIF (preuve du lot 6, D-1) ? `GET /api/admin/campaigns/[id]` ne la borne pas
 * pour un super_admin, et React s'en sert : la route ne change pas, le contrôle est ici. La règle est celle de la liste
 * (`GET /api/admin/campaigns`, celle du hall et du sélecteur) : espace « Toutes » (`active_org_id` nul), propriétaire,
 * ou espace lié (`campaign_organizations`, lu seulement si l'espace actif n'est pas le propriétaire). Hors de l'espace :
 * `CampagneIntrouvable` — « introuvable dans cet espace », paramètre retiré, ni brouillon ni lancement.
 */
export function verifierEspace(campagne: Campagne, organisations: OrganisationsApi, plan: PlanApi): Observable<null> {
  const hors = () => throwError(() => new CampagneIntrouvable());
  return organisations.lister().pipe(
    switchMap(({ active_org_id: actif }) => {
      if (!actif || campagne.organization_id === actif) return of(null);
      return plan.organisationsCampagne(campagne.id).pipe(
        catchError((e: unknown) => throwError(() => classer(e))),
        switchMap((r) => (r.organizations.some((o) => o.id === actif) ? of(null) : hors())),
      );
    }),
    map(() => null),
  );
}

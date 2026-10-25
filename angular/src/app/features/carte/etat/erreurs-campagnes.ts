import { HttpErrorResponse } from '@angular/common/http';
import { messageErreurApi } from '../../../core/http/erreurs';

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

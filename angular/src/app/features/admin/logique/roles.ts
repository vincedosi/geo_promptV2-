/**
 * Copie de `lib/auth/roles.ts` (lot 6, 2026-10-06) ; parité : `tests/unit/angular/admin-logique-paritaire.test.ts`.
 *
 * Sans `RoleSchema` / `RoleMembreSchema` : pas de Zod côté Angular (A12). `UserRole` vient de la
 * copie locale `./types/admin` : rien n'est importé hors d'`angular/`.
 */
import type { UserRole } from './types/admin';

export type { UserRole };

export const ROLE_LEVELS = { super_admin: 0, admin: 1, client: 2 } satisfies Record<UserRole, number>;
export const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin', client: 'Client' } satisfies Record<UserRole, string>;

/** Tous les rôles, dans l'ordre de pouvoir décroissant. */
export const ROLES = Object.keys(ROLE_LEVELS) as [UserRole, ...UserRole[]];

/** Rôles attribuables à un MEMBRE d'une organisation : `super_admin` en est exclu. */
export const ROLES_MEMBRE = ROLES.filter((r) => r !== 'super_admin') as [UserRole, ...UserRole[]];

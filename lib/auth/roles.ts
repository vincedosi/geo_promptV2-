/**
 * @file lib/auth/roles.ts
 *
 * Source unique des rôles applicatifs : niveaux, libellés et schémas Zod.
 *
 * La liste était écrite à quatre endroits — `app/api/admin/roles/route.ts`
 * (supprimée le 2026-10-10 avec la page React Users, son seul appelant),
 * et trois littéraux dans `organizations/[id]/members/route.ts`. Une liste
 * d'autorisation recopiée est une liste qui divergera : `editor` a été retiré
 * du modèle le 2026-09-10 et survivait encore dans des tableaux en dur.
 *
 * `satisfies Record<UserRole, …>` est le garde-fou : ajouter un rôle à
 * `UserRole` sans le déclarer ici casse le build, au lieu de le faire
 * disparaître en silence des sélecteurs et des validations.
 */
import { z } from 'zod';
import type { UserRole } from '@/types/admin';

export const ROLE_LEVELS = { super_admin: 0, admin: 1, client: 2 } satisfies Record<UserRole, number>;
export const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin', client: 'Client' } satisfies Record<UserRole, string>;

/** Tous les rôles, dans l'ordre de pouvoir décroissant. */
export const ROLES = Object.keys(ROLE_LEVELS) as [UserRole, ...UserRole[]];

/** Un rôle quelconque. */
export const RoleSchema = z.enum(ROLES);

/**
 * Rôles attribuables à un MEMBRE d'une organisation.
 *
 * `super_admin` en est exclu : on ne promeut pas quelqu'un administrateur de
 * la plateforme depuis l'écran d'une organisation. C'est la règle que le
 * littéral `['admin', 'client']` exprimait — dérivée, désormais, au lieu
 * d'être recopiée.
 */
export const ROLES_MEMBRE = ROLES.filter((r) => r !== 'super_admin') as [UserRole, ...UserRole[]];
export const RoleMembreSchema = z.enum(ROLES_MEMBRE);

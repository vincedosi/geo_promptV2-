/**
 * Règles PURES de la fiche utilisateur (`fiche-utilisateur.component.ts`) : quels rôles la fiche
 * propose, et ce que dit la confirmation d'un changement de rôle. Sorties du composant au lot 4
 * (T22) pour se tester sans TestBed ; le composant ne garde que l'état et les écritures.
 */
import { ROLES, ROLE_LABELS, type UserRole } from '../../logique/roles';
import type { RoleEspace } from './types';

/** E5 : seuls ces deux rôles sont proposés, jamais `admin`. */
export const ROLES_PROPOSES = ['client', 'super_admin'] as const satisfies readonly UserRole[];
export type RolePropose = (typeof ROLES_PROPOSES)[number];

/**
 * Les radios affichés : les rôles proposés, plus le rôle ACTUEL s'il ne l'est pas (un membre
 * `admin` voit son rôle coché, sans qu'on puisse le lui rendre une fois quitté). Ordre de pouvoir
 * croissant, tiré de `ROLES` (copie de `lib/auth/roles.ts`) : Client, Admin, Super admin.
 */
export function rolesAffiches(actuel: RoleEspace): UserRole[] {
  return [...ROLES].reverse().filter((r) => r === actuel || (ROLES_PROPOSES as readonly UserRole[]).includes(r));
}

/** Le rôle cliqué fait-il partie de ceux que la fiche propose ? */
export function estPropose(r: string): r is RolePropose {
  return (ROLES_PROPOSES as readonly string[]).includes(r);
}

/** Les textes d'une confirmation de rôle. */
export interface TextesConfirmationRole {
  titre: string;
  message: string;
  bouton: string;
  variante: 'danger' | 'defaut';
}

/**
 * Textes de la confirmation, selon la transition (rôle accepté → rôle visé). Les deux sens se
 * confirment ; quitter super_admin ou un rôle qui n'est plus proposé est `danger`.
 */
export function textesConfirmationRole(email: string, vise: RolePropose | null, actuel: RoleEspace): TextesConfirmationRole {
  if (vise === 'client' && actuel === 'super_admin') {
    return {
      titre: 'Retirer le rôle super-administrateur ?',
      message: `${email} ne verra plus tous les espaces : il ne gardera que ceux dont il est membre.`,
      bouton: 'Retirer le rôle',
      variante: 'danger',
    };
  }
  if (vise === 'client') {
    return {
      titre: `Passer au rôle ${ROLE_LABELS.client} ?`,
      message: `${email} perd le rôle ${ROLE_LABELS[actuel]}. Ce rôle n'est plus attribué depuis cette page : il ne pourra pas lui être rendu ici.`,
      bouton: `Passer au rôle ${ROLE_LABELS.client}`,
      variante: 'danger',
    };
  }
  return {
    titre: 'Nommer super-administrateur ?',
    message: `${email} verra les données de tous les espaces, quel que soit son espace actif.`,
    bouton: 'Nommer super-administrateur',
    variante: 'defaut',
  };
}

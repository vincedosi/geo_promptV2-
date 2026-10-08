/**
 * lib/chat/tools/orgContext.ts
 * Contexte request-scoped via AsyncLocalStorage.
 * Permet d'injecter orgSourceIds dans les outils IA sans modifier la signature
 * figée de buildTools/executeToolCall (schemas.ts interdit).
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface OrgContext {
  /** null = pas de filtre (super_admin ou dev), [] = aucun accès, [...] = filtre actif */
  orgSourceIds: string[] | null;
}

export const orgContextStorage = new AsyncLocalStorage<OrgContext>();

/**
 * Raccourci : lit orgSourceIds depuis le contexte courant.
 *
 * SANS contexte, rend `[]` (aucun accès) — et non plus `null` (tout voir),
 * comme jusqu'au 2026-10-08. Un outil appelé hors de `/api/chat`, qui seul
 * pose le contexte, ouvrait sinon les données de toutes les organisations.
 * `null` ne sort d'ici que si le contexte le porte : un super_admin.
 */
export function getOrgSourceIds(): string[] | null {
  const contexte = orgContextStorage.getStore();
  return contexte ? contexte.orgSourceIds : [];
}

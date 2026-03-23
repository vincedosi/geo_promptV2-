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

/** Raccourci : lit orgSourceIds depuis le contexte courant (null si aucun contexte). */
export function getOrgSourceIds(): string[] | null {
  return orgContextStorage.getStore()?.orgSourceIds ?? null;
}

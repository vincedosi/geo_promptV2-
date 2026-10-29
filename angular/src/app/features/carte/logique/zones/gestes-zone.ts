/**
 * Logique PURE des gestes de « Mes zones » (③ finitions, T5) : le nom d'une copie, la lecture d'un refus de recalcul,
 * l'issue d'une duplication, et les ensembles d'identifiants « en vol » tenus sans mutation.
 *
 * « Dupliquer » (`POST /api/zones/[id]/dupliquer`, arbitrage A-5) écrit TOUJOURS une nouvelle zone : forme copiée en
 * base pour une zone figée, recette rejouée À NEUF pour une zone recalculable. La zone source n'est jamais écrite. La
 * route n'est PAS idempotente : l'appelant bloque le second clic, et une réponse perdue renvoie à « Mes zones ».
 */
import type { HttpResponse } from '@angular/common/http';
import type { ZoneEcrite } from '../../data/zones.api';

/** La longueur maximale d'un nom de zone (`nom` 1-200 des routes de zone). */
const NOM_MAX = 200;
const SUFFIXE = ' (copie)';

/** Le message d'une réponse perdue : la zone existe peut-être, jamais de second envoi à l'aveugle (patron de l'atelier). */
export const MESSAGE_REPONSE_PERDUE = 'La réponse n’est pas arrivée : vérifiez Mes zones avant de réessayer.';

/** « <nom> (copie) », le nom tronqué pour que le tout tienne dans les 200 caractères de la route. */
export function nomDeCopie(nom: string): string {
  return `${nom.trim().slice(0, NOM_MAX - SUFFIXE.length)}${SUFFIXE}`;
}

/** Vrai quand un recalcul est refusé parce que la zone est citée par un plan (409 `zone_referencee`, sql/253). */
export function estRefusReferencee(e: { status?: number; error?: unknown }): boolean {
  return e.status === 409 && (e.error as { refus?: unknown } | null | undefined)?.refus === 'zone_referencee';
}

/**
 * Ce qu'on dit d'une duplication RÉUSSIE côté HTTP. Un 207 est une réussite (la zone existe, seuls ses codes postaux
 * n'ont pas été résolus) : son message est dit. Un 2xx sans `zone_id` se traite comme une réponse perdue.
 */
export function issueDuplication(r: HttpResponse<ZoneEcrite>, nom: string): string {
  const b = r.body;
  if (!b?.zone_id) return MESSAGE_REPONSE_PERDUE;
  if (r.status === 207) return b.message ?? `Zone « ${nom} » créée ; ses codes postaux n’ont pas pu être résolus.`;
  return `Zone dupliquée : ${nom}`;
}

/** Un nouvel ensemble avec `id`. */
export function avecId(s: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(s).add(id);
}

/** Un nouvel ensemble sans `id`. */
export function sansId(s: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const c = new Set(s);
  c.delete(id);
  return c;
}

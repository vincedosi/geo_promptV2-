/**
 * @file lib/zones/session-zones.ts — ce que les trois routes de zones à recette partagent (lot 3, spec
 * carte-en-parcours § 16) : `POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`.
 *
 * L'espace : `profile.organization_id` du profil rendu par `requireAuth` — l'espace ACTIF (`/api/user/switch-org`
 * l'écrit ; `getSessionOrg` lit le même champ). Le garde `requireAuth(` reste écrit DANS chaque route : c'est ce que
 * `tests/unit/api/routes-publiques.test.ts` reconnaît (arbitrage L3-7) ; `middleware.ts`, protégé, n'est pas touché.
 * Les sources de POI visibles : `getOrgSourceIds(…, { vueEspace: true })`, la règle de `sourcesVisiblesDeLaRequete`.
 *
 * L'ORDRE est le contrat : profil → corps → recette → quota → SEULEMENT ALORS les sources et le calcul. Une requête
 * refusée (corps invalide, quota épuisé, zone figée ou citée) ne lit rien en base.
 *
 * Le quota : UN limiteur pour l'aperçu, l'écriture et le recalcul (A-7) — 12 / min / compte. Un aperçu suivi d'un
 * enregistrement coûte 2 jetons (6 zones / min au plus) ; au pire mesuré (≈ 90 000 buffers par appel : une
 * zone-périmètre dense de 12 000 km², l'IDF ; ≤ 69 000 pour un département), ≤ 1,1 M buffers / min / compte.
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { UserProfile, createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { executerRecette, type ContexteRecette, type IssueRecette } from './executer-recette';
import { estRecalculable, type Recette, type RefusRecette } from './recette';
import { lireRecette } from './recette-schema';

type ClientAdmin = ReturnType<typeof createAdminClient>;

/** Non exporté : les routes passent par `quotaZones` / `preparerRecette` (knip compterait l'export mort). */
const limiteurZones = createRateLimiter({ max: 12, window: '60 s', prefix: 'geo:rl:zones' });

/** L'espace actif d'une session : l'auteur, l'espace où la zone se lit et s'écrit, le rôle (pour les sources). */
interface EspaceZone {
  userId: string;
  orgId: string;
  role: UserProfile['role'];
}

type Echec = { ok: false; reponse: NextResponse };

/** 401 sans profil, 403 sans espace actif. Aucune lecture : le profil vient de `requireAuth`. */
export function espaceDeZone(profil: UserProfile | null): { ok: true; espace: EspaceZone } | Echec {
  if (!profil) return { ok: false, reponse: NextResponse.json({ error: 'Session expirée.' }, { status: 401 }) };
  if (!profil.organization_id) return { ok: false, reponse: NextResponse.json({ error: 'Aucun espace actif.' }, { status: 403 }) };
  return { ok: true, espace: { userId: profil.id, orgId: profil.organization_id, role: profil.role } };
}

/** Le quota partagé des trois routes ; `null` quand il reste un jeton. */
export async function quotaZones(espace: EspaceZone): Promise<NextResponse | null> {
  const quota = await limiteurZones(espace.userId);
  return quota.ok ? null : rateLimitResponse(quota.retrySec);
}

/** Le corps attendu par l'aperçu et l'écriture : au moins `recette`, et `geometrie` pour une forme figée. */
type SchemaCorpsZone = z.ZodType<{ recette?: unknown; geometrie?: unknown }, z.ZodTypeDef, unknown>;

/**
 * La chaîne commune de l'aperçu et de l'écriture : espace → corps → recette → quota. Rien n'est lu en base avant
 * que le quota soit consommé ; un corps invalide ne consomme pas de jeton.
 */
export async function preparerRecette<S extends SchemaCorpsZone>(
  profil: UserProfile | null,
  req: Request,
  schema: S,
): Promise<{ ok: true; espace: EspaceZone; corps: z.infer<S>; recette: Recette } | Echec> {
  const s = espaceDeZone(profil);
  if (!s.ok) return s;
  const corps = await lireCorps(req, schema);
  if (!corps.ok) return { ok: false, reponse: NextResponse.json({ error: corps.message }, { status: 400 }) };
  const lue = lireRecette(corps.valeur.recette);
  if (!lue.ok) return { ok: false, reponse: NextResponse.json({ error: lue.message }, { status: 400 }) };
  const refusQuota = await quotaZones(s.espace);
  if (refusQuota) return { ok: false, reponse: refusQuota };
  return { ok: true, espace: s.espace, corps: corps.valeur, recette: lue.recette };
}

/**
 * Lit les sources visibles de l'espace PUIS exécute la recette. Une recette RECALCULABLE ne reçoit jamais la
 * géométrie du client (Review Focus 4 : le serveur la recalcule) ; seule une forme figée la transmet.
 */
export async function executerDansEspace(
  supabase: ClientAdmin,
  espace: EspaceZone,
  recette: Recette,
  geometrie?: unknown,
): Promise<IssueRecette> {
  const sources = await getOrgSourceIds({ userId: espace.userId, orgId: espace.orgId, role: espace.role }, { vueEspace: true });
  const ctx: ContexteRecette = { orgId: espace.orgId, sources: sources ?? [] };
  if (!estRecalculable(recette)) ctx.geometrie = geometrie;
  return executerRecette(supabase, recette, ctx);
}

/** Un refus (exécuteur ou RPC) en réponse HTTP : `{ error, refus? }`, la clé `refus` absente quand il n'y en a pas. */
export function reponseRefus(r: { statut: number; message: string; refus: RefusRecette | null }): NextResponse {
  return NextResponse.json({ error: r.message, ...(r.refus ? { refus: r.refus } : {}) }, { status: r.statut });
}

/**
 * Résout les codes de la zone (compteurs de « Mes zones » ; n'achète rien) ; 207 si la résolution échoue (délai,
 * accès) — la zone existe (Review Focus 5). Partagé par l'écriture et le recalcul : un fichier `route.ts` ne peut
 * exporter que ses verbes HTTP.
 */
export async function repondreResolue(supabase: ClientAdmin, zoneId: string, userId: string, surface: number | null): Promise<NextResponse> {
  const res = await supabase.rpc('resolve_custom_geo_zone_codes', { p_zone_id: zoneId, p_caller_user_id: userId });
  if (res.error) {
    console.error('[zones] resolve_custom_geo_zone_codes :', res.error.message);
    return NextResponse.json({ zone_id: zoneId, warning: 'codes_non_resolus', message: 'Zone créée ; ses codes postaux n’ont pas pu être résolus.' }, { status: 207 });
  }
  const c: Readonly<Record<string, unknown>> = res.data !== null && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : {};
  return NextResponse.json({ zone_id: zoneId, count_cp: entier(c.count_cp), count_iris: entier(c.count_iris), surface_km2: surface });
}

function entier(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

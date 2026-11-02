/**
 * @file lib/zones/session-zones.ts — ce que les routes de zones à recette partagent (lot 3, spec
 * carte-en-parcours § 16) : `POST /api/zones/apercu`, `POST /api/zones`, `POST /api/zones/[id]/recalculer`, et
 * `POST /api/zones/[id]/dupliquer` (③ finitions, T2).
 *
 * L'espace : `profile.organization_id` du profil rendu par `requireAuth` — l'espace ACTIF (`/api/user/switch-org`
 * l'écrit ; `getSessionOrg` lit le même champ). Le garde `requireAuth(` reste écrit DANS chaque route : c'est ce que
 * `tests/unit/api/routes-publiques.test.ts` reconnaît (arbitrage L3-7) ; `middleware.ts`, protégé, n'est pas touché.
 * Les sources de POI visibles : `getOrgSourceIds(…, { vueEspace: true })`, la règle de `sourcesVisiblesDeLaRequete`.
 * Les indicateurs visibles (seuil sur territoires, sql/288) : `indicateursVisiblesDeLaSession`, la règle de
 * `indicateursVisibles` — posée ICI, point de passage unique de la création, de l'aperçu et du recalcul, et non
 * dans la RPC `zone_seuil_territoire` (plan du lot « Catalogue et groupes », T2).
 *
 * L'ORDRE est le contrat : profil → corps → recette → quota → SEULEMENT ALORS les sources et le calcul. Une requête
 * refusée (corps invalide, quota épuisé, zone figée ou citée) ne lit rien en base.
 *
 * Le quota : UN limiteur pour l'aperçu, l'écriture, le recalcul et la duplication (A-7) — 12 / min / compte. Un aperçu suivi d'un
 * enregistrement coûte 2 jetons (6 zones / min au plus) ; au pire mesuré (≈ 90 000 buffers par appel : une
 * zone-périmètre dense de 12 000 km², l'IDF ; ≤ 69 000 pour un département), ≤ 1,1 M buffers / min / compte.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { UserProfile, createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { indicateursVisiblesDeLaSession } from '@/lib/auth/perimetre-donnees';
import { createQuota } from '@/lib/api/rate-limit';
import { lireCorps } from '@/lib/api/valider-corps';
import { executerRecette, type ContexteRecette, type IssueRecette } from './executer-recette';
import { MESSAGES_REFUS, exigeGeometrie, type Recette, type RefusRecette } from './recette';
import { lireRecette } from './recette-schema';

type ClientAdmin = ReturnType<typeof createAdminClient>;

const limiteurZones = createQuota({ max: 12, window: '60 s', prefix: 'geo:rl:zones' });

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

/** Le quota partagé des routes de zone (dupliquer compris) ; `null` quand il reste un jeton. */
export function quotaZones(espace: EspaceZone): Promise<NextResponse | null> {
  return limiteurZones(espace.userId);
}

/** 404 `zone_introuvable` : absente, d'un autre espace (on ne révèle pas qu'elle existe ailleurs) ou id illisible. */
export function zoneIntrouvable(): NextResponse {
  return reponseRefus({ statut: 404, refus: 'zone_introuvable', message: MESSAGES_REFUS.zone_introuvable });
}

/** L'id de zone d'une route `/api/zones/[id]/…` ; sinon 404 (décision CdP T6), sans rien lire en base. */
export function idDeZone(id: string): string | NextResponse {
  return z.string().uuid().safeParse(id).success ? id : zoneIntrouvable();
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
 * Lit les sources visibles de l'espace — pour un rayon autour des POI SEULEMENT, la seule recette qui les emploie —
 * et les indicateurs visibles — pour un seuil sur territoires seulement — PUIS exécute la recette. Une recette calculée par le serveur (recalculable ou combinaison) ne reçoit jamais la
 * géométrie du client (Review Focus 4) ; seule une forme figée la transmet (`exigeGeometrie`).
 */
export async function executerDansEspace(
  supabase: ClientAdmin,
  espace: EspaceZone,
  recette: Recette,
  geometrie?: unknown,
): Promise<IssueRecette> {
  const session = { userId: espace.userId, orgId: espace.orgId, role: espace.role };
  const sources = recette.type === 'rayon_poi' ? await getOrgSourceIds(session, { vueEspace: true }) : null;
  const ctx: ContexteRecette = { orgId: espace.orgId, sources: sources ?? [] };
  if (recette.type === 'seuil_territoire') ctx.indicateurs = (await indicateursVisiblesDeLaSession(session)).visibles;
  if (exigeGeometrie(recette)) ctx.geometrie = geometrie;
  return executerRecette(supabase, recette, ctx);
}

/**
 * B15 : la recette à ÉCRIRE après un calcul (création, duplication, recalcul) — un seuil sur territoires ou une capture
 * porte les unités que le SERVEUR a établies (`issue.unites`), jamais celles du client ; sans unités, la clé est
 * retirée. Les autres recettes sont écrites telles quelles (une liste de CP : la base dérive ses unités, sql/320).
 */
export function recetteAEcrire(recette: Recette, issue: Extract<IssueRecette, { ok: true }>): Recette {
  if (recette.type !== 'seuil_territoire' && recette.type !== 'capture') return recette;
  const { unites_constitutives: _client, ...reste } = recette;
  return issue.unites ? { ...reste, unites_constitutives: issue.unites } : reste;
}

/** Les refus que `creer_zone_recette` (sql/253) peut rendre à la place de `{ id }`. */
const REFUS_CREATION = ['zone_introuvable', 'perimetre_inconnu'] as const;
type RefusCreation = (typeof REFUS_CREATION)[number];

/**
 * Rétrécit le `Json` de `creer_zone_recette` : `{ id }`, `{ refus }` du contrat, ou `null` (hors contrat → 500).
 * Partagé par `POST /api/zones` et `POST /api/zones/[id]/dupliquer` (une recette recalculable dupliquée s'écrit
 * comme une création).
 */
export function lireCreation(data: unknown): { id: string } | { refus: RefusCreation } | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (typeof o.refus === 'string') {
    const refus = REFUS_CREATION.find((r) => r === o.refus);
    return refus ? { refus } : null;
  }
  return typeof o.id === 'string' && o.id !== '' ? { id: o.id } : null;
}

/** Un refus (exécuteur ou RPC) en réponse HTTP : `{ error, refus? }`, la clé `refus` absente quand il n'y en a pas. */
export function reponseRefus(r: { statut: number; message: string; refus: RefusRecette | null }): NextResponse {
  return NextResponse.json({ error: r.message, ...(r.refus ? { refus: r.refus } : {}) }, { status: r.statut });
}

/**
 * Résout les codes de la zone (compteurs de « Mes zones » ; n'achète rien) ; 207 si la résolution échoue (délai,
 * accès) — la zone existe (Review Focus 5). Partagé par l'écriture et le recalcul : un fichier `route.ts` ne peut
 * exporter que ses verbes HTTP. Le message du 207 dit l'action (`creation` ou `recalcul`) : après un recalcul, la
 * zone n'a pas été « créée ».
 *
 * Une zone PAYS (`pays`, sql/296) n'est pas résolue par la géométrie : `resolve_custom_geo_zone_codes` lirait tous les
 * IRIS de France (2,1 s, 48 540 accès, ≈ 48 000 lignes de codes écrites). `compter_zone_pays` pose les deux compteurs
 * par des comptes (8,7 ms, 574 accès), sans écrire de code.
 */
export async function repondreResolue(
  supabase: ClientAdmin, zoneId: string, userId: string, surface: number | null, action: 'creation' | 'recalcul', pays = false,
): Promise<NextResponse> {
  const rpc = pays ? 'compter_zone_pays' : 'resolve_custom_geo_zone_codes';
  const res = await supabase.rpc(rpc, { p_zone_id: zoneId, p_caller_user_id: userId });
  if (res.error) {
    console.error(`[zones] ${rpc} :`, res.error.message);
    const message = action === 'recalcul'
      ? 'Zone recalculée, mais ses codes postaux n’ont pas pu être résolus.'
      : 'Zone créée ; ses codes postaux n’ont pas pu être résolus.';
    return NextResponse.json({ zone_id: zoneId, warning: 'codes_non_resolus', message }, { status: 207 });
  }
  const c: Readonly<Record<string, unknown>> = res.data !== null && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : {};
  return NextResponse.json({ zone_id: zoneId, count_cp: entier(c.count_cp), count_iris: entier(c.count_iris), surface_km2: surface });
}

function entier(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * lib/auth/perimetre-donnees.ts
 * Appliquer la règle d'autorisation des données importées à une requête.
 *
 * La règle elle-même — QUELLES sources une session voit — vit dans
 * `getOrgSourceIds` (et sa jumelle SQL `source_visible`, sql/234). Ce module
 * ne fait que la poser sur une requête, une seule fois écrite, pour que
 * chaque route n'en réinvente pas une variante.
 *
 * ── LES RÉFÉRENTIELS SYSTÈME ───────────────────────────────────────────────
 *
 * Un POI SANS source (`data_source_id is null`) a été chargé par un script
 * système — arrêts de transport (285 015), installations classées (99 152) —
 * jamais par l'import d'un client : `import-poi/execute` refuse d'écrire une
 * ligne sans source. Ces lignes sont donc du socle.
 *
 * `referentiels: true` les inclut. On ne le passe QUE sur une route qui lit
 * une catégorie de référentiel (transport, panneaux, natures) : ailleurs,
 * `.in('data_source_id', …)` suffit et reste la forme la plus lisible.
 *
 * `tests/unit/securite/perimetre-routes.test.ts` impose que toute route hors
 * /api/admin qui lit une table de données client passe par ce module.
 */
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionOrg } from '@/lib/auth/getSessionOrg';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Réserve une route au super_admin, session lue par COOKIE ou en-tête.
 *
 * `requireAdmin` (lib/api/middleware) ne lit que l'en-tête `Authorization` ;
 * les écrans de la carte appellent avec un `fetch` nu, qui n'envoie que le
 * cookie — il refuserait le super_admin lui-même. `getSessionOrg` lit les
 * deux.
 *
 * @returns `null` si l'appelant est super_admin, sinon la réponse 403 à rendre.
 *
 * @example
 * const refus = await reserverAuSuperAdmin(req);
 * if (refus) return refus;
 */
export async function reserverAuSuperAdmin(req: NextRequest): Promise<NextResponse | null> {
  const session = await getSessionOrg(req);
  if (session?.role === 'super_admin') return null;
  return NextResponse.json(
    { error: 'Réservé aux administrateurs MAGELIAN.' },
    { status: 403 },
  );
}

/**
 * Les sources visibles de l'appelant d'une route.
 *
 * @returns `null` pour un super_admin (aucun filtre), sinon la liste des
 *   sources visibles — jamais `null` pour un autre appelant, même sans session.
 */
export async function sourcesVisiblesDeLaRequete(req: NextRequest): Promise<string[] | null> {
  return getOrgSourceIds(await getSessionOrg(req));
}

/**
 * Les trois méthodes employées, sans les génériques de postgrest-js : leurs
 * signatures typent la colonne par table, ce qui rendrait ce helper
 * inutilisable d'une table à l'autre (« Type instantiation excessively
 * deep », déjà rencontré dans /api/map/pois).
 */
/**
 * Empreinte d'un périmètre, à inclure dans toute clé de cache d'un résultat
 * calculé sur des POI.
 *
 * Un résultat mis en cache sous une clé qui ne dépend que des FILTRES
 * (catégorie, paliers, région) est resservi à quiconque pose les mêmes
 * filtres : la battle calculée par un super_admin sur toutes les concessions
 * BMW l'aurait été à la Marine. Avec l'empreinte, deux appelants qui VOIENT la
 * même chose partagent le cache — et eux seuls.
 *
 * @returns `tout` pour un super_admin, sinon 12 caractères hexadécimaux
 *   stables (indépendants de l'ordre des sources).
 */
export function empreintePerimetre(sources: string[] | null): string {
  if (sources === null) return 'tout';
  const cle = [...sources].sort().join(',');
  return createHash('sha1').update(cle).digest('hex').slice(0, 12);
}

/**
 * Une clé de cache de battle complète appartient-elle au périmètre de
 * l'appelant ?
 *
 * Les routes qui RELISENT un résultat par sa clé (`custom-geo/source/battle`)
 * la reçoivent du navigateur : sans ce contrôle, un client demanderait la clé
 * d'un autre. Une clé antérieure au 2026-10-08 (sans `__p`) n'est rendue qu'au
 * super_admin ; un client la recalculera, sous une clé à son empreinte.
 */
export function cleDeCacheDuPerimetre(cle: string, sources: string[] | null): boolean {
  if (sources === null) return true;
  return cle.endsWith(`__p${empreintePerimetre(sources)}`);
}

/**
 * Une catégorie est-elle ENTIÈREMENT visible de l'appelant ?
 *
 * Pour les calculs faits en SQL sur toute une catégorie — Voronoï, modèles de
 * clustering — qu'on ne peut pas restreindre ligne à ligne : si un seul POI de
 * la catégorie appartient à une source que l'appelant ne voit pas, le résultat
 * en révélerait l'emplacement. On refuse alors le calcul, plutôt que de le
 * rendre faux ou indiscret.
 *
 * Une lecture d'un POI au plus (`limit(1)`), sur l'index de `categorie`.
 */
export async function categorieEntierementVisible(
  supabase: { from(table: 'poi_france'): unknown },
  categorie: string,
  sources: string[] | null,
): Promise<boolean> {
  if (sources === null) return true;
  const ids = sources.filter((s) => UUID.test(s));
  // Requête non typée : voir FiltrableParSource.
  let q: any = (supabase.from('poi_france') as any)
    .select('id')
    .ilike('categorie', categorie)
    .not('data_source_id', 'is', null);
  if (ids.length > 0) q = q.not('data_source_id', 'in', `(${ids.join(',')})`);
  const { data, error } = await q.limit(1);
  // Une lecture en échec ferme.
  if (error) return false;
  return (data ?? []).length === 0;
}

interface FiltrableParSource {
  in(colonne: string, valeurs: readonly string[]): unknown;
  or(expression: string): unknown;
  is(colonne: string, valeur: null): unknown;
}

/**
 * Restreint une requête aux lignes dont la source est visible.
 *
 * @param q - La requête PostgREST, avant exécution.
 * @param sources - Le retour de `getOrgSourceIds` / `sourcesVisiblesDeLaRequete`.
 * @param options.referentiels - Inclure les lignes SANS source (référentiels
 *   système). Faux par défaut.
 *
 * @example
 * const sources = await sourcesVisiblesDeLaRequete(req);
 * let q = sb.from('poi_france').select('id').eq('categorie', 'arret_transport');
 * q = filtrerParSourcesVisibles(q, sources, { referentiels: true });
 */
export function filtrerParSourcesVisibles<Q>(
  q: Q,
  sources: string[] | null,
  options: { referentiels?: boolean } = {},
): Q {
  if (sources === null) return q;
  const f = q as unknown as FiltrableParSource;
  // Les identifiants viennent de la base ; on ne les interpole pas pour autant
  // sans vérifier leur forme — même garde que SEC-002.
  const ids = sources.filter((s) => UUID.test(s));
  if (!options.referentiels) return f.in('data_source_id', ids) as Q;
  if (ids.length === 0) return f.is('data_source_id', null) as Q;
  return f.or(`data_source_id.is.null,data_source_id.in.(${ids.join(',')})`) as Q;
}

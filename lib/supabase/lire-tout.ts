/**
 * Lecture PAGINÉE d'une table PostgREST.
 *
 * ── LE PLAFOND QUE `.limit()` NE LÈVE PAS ─────────────────────────────────
 *
 * PostgREST applique un `db-max-rows` côté SERVEUR. Sur ce stack il vaut
 * **1 000** (`supabase/config.toml:18`, `PGRST_DB_MAX_ROWS=1000`, vérifié dans
 * l'environnement du conteneur le 2026-09-20), et **aucun `.limit()` client ne
 * le dépasse** : c'est un plafond, pas un défaut.
 *
 * ⚠ **C'est le MÊME plafond que celui des RPC `RETURNS TABLE`/`SETOF`.**
 * Cet en-tête disait jusqu'au 2026-10-10 qu'il s'agissait d'un autre plafond,
 * « quatre fois plus bas » que « la troncature à 5 000 des RPC ». Faux : le
 * 5 000 était le réglage du projet hébergé, supprimé le 2026-09-21. Mesuré le
 * 2026-10-10 : `get_zone_centroids('cp')` rendait 1 000 lignes sur 6 187. Une
 * table se lit par pages (cette fonction) ; une RPC tabulaire ne se pagine pas,
 * elle passe en `RETURNS jsonb` (`CLAUDE.md` § « Troncature PostgREST »).
 *
 * ⚠ **Paginer n'est pas toujours la bonne réponse.** Chaque page refait le
 * parcours de l'index depuis le début : sur un gros index filtré (les arrêts
 * de transport d'une vue, ≈ 177 000 buffers), une RPC `jsonb` qui lit en UN
 * passage avec une borne écrite vaut mieux (sql/241).
 *
 * Constaté le 2026-09-20 : `zone_set_cp` portait 1 942 codes postaux,
 * `.select(...).limit(7000)` en rendait **1 000**, et le plan écrit dans
 * `bidding_zone_configs` couvrait donc la moitié du jeu. Le script annonçait
 * « 1 000 codes postaux » sans que rien ne signale l'amputation — un plan
 * partiel qui se présente comme complet.
 *
 * ── CE QUE CETTE FONCTION GARANTIT ────────────────────────────────────────
 *
 * Tout ou une erreur. Jamais un silence. Si la table dépasse `plafond`, la
 * lecture ÉCHOUE plutôt que de rendre un début : une borne franchie doit se
 * voir, pas se deviner.
 */
/** Taille d'une page. Reste sous `db-max-rows` avec de la marge. */
const PAGE = 1000;

/**
 * Ce qu'une requête PostgREST rend une fois attendue.
 *
 * Typé ici plutôt qu'importé de `@supabase/postgrest-js` : le
 * `PostgrestFilterBuilder` porte six paramètres de type dont la plupart
 * décrivent le schéma, et les satisfaire depuis un appelant générique
 * demanderait autant de casts qu'on en économiserait.
 */
type ReponsePage<T> = { data: T[] | null; error: { message: string } | null };

export interface ResultatLecture<T> {
  lignes: T[];
  /** Nombre de pages effectivement lues. Sert au diagnostic, pas au calcul. */
  pages: number;
}

/**
 * Lit toutes les lignes d'une requête, page par page.
 *
 * @param construire - Fabrique la requête. Appelée une fois par page, parce
 *   qu'un `PostgrestFilterBuilder` ne se rejoue pas : il porte sa promesse et
 *   la réutiliser rendrait la même page indéfiniment.
 * @param plafond - Au-delà, la lecture échoue. Une borne franchie doit se voir.
 * @returns Toutes les lignes, ou une erreur.
 * @throws {Error} Si une page échoue, ou si le plafond est franchi.
 *
 * @example
 * const { lignes } = await lireTout(
 *   (de, a) => sb.from('zone_set_cp').select('*').eq('zone_set_id', id).range(de, a),
 *   7000,
 * );
 */
export async function lireTout<T>(
  construire: (de: number, a: number) => PromiseLike<ReponsePage<T>>,
  plafond: number,
): Promise<ResultatLecture<T>> {
  const lignes: T[] = [];
  let pages = 0;

  for (let de = 0; de < plafond; de += PAGE) {
    const { data, error } = await construire(de, de + PAGE - 1);
    if (error) {
      throw new Error(`Lecture paginée interrompue à la ligne ${de} : ${error.message}`);
    }
    pages += 1;
    const page = data ?? [];
    lignes.push(...page);
    // Une page incomplète est la DERNIÈRE : PostgREST ne rend jamais moins que
    // demandé s'il lui reste des lignes.
    if (page.length < PAGE) return { lignes, pages };
  }

  throw new Error(
    `Plus de ${plafond} lignes à lire. La lecture est interrompue plutôt que tronquée : `
    + `un résultat amputé en silence est pire qu'une erreur.`,
  );
}

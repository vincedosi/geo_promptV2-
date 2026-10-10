/**
 * Borne et mention de coupe de l'export CSV d'une source admin
 * (`GET /api/admin/sources/[id]/export`).
 *
 * Hors du fichier de route : Next refuse qu'un `route.ts` exporte autre chose
 * que ses verbes et sa configuration, et le test doit lire la MÊME borne.
 */
import { formaterNombre } from '@/lib/format/nombre';

/**
 * Nombre maximal de lignes d'un export de source.
 *
 * La valeur que la route croyait déjà appliquer (`.limit(50000)`), mais qui
 * sortait en 1 000 lignes sous `db-max-rows`. Lue désormais par pages de 1 000
 * triées sur `id`, 51 requêtes séquentielles au plus : un export admin,
 * déclenché à la main, jamais en parallèle. Une source de 285 000 lignes sort
 * donc en ses 50 000 premières par identifiant, et le fichier le DIT
 * (`mentionCoupe`).
 *
 * Coût mesuré (2026-10-11, plus grosse source locale, 5 584 POI) : 6 pages
 * d'environ 315 buffers chacune — chaque page relit la source par
 * `idx_poi_france_data_source` puis trie, donc le coût d'une page croît avec
 * la SOURCE. Un index `(data_source_id, id)` a été essayé et écarté : 1 000
 * buffers par page sur ce cas (accès au tas dans l'ordre des id), 15 Mo
 * d'index et un coût à chaque import de POI, pour un gain réservé à des
 * sources de plusieurs dizaines de milliers de lignes qui n'existent pas
 * encore. À reconsidérer le jour où il y en a une.
 *
 * Relever cette borne, c'est relever le nombre de requêtes d'un seul clic :
 * mesurer avant (CLAUDE.md, § Disk I/O).
 */
export const BORNE_EXPORT_SOURCE = 50_000;

/**
 * Dernière ligne du CSV quand la borne a coupé. Commence par `#` : visible à
 * l'ouverture dans un tableur, et facile à écarter pour un script.
 *
 * @param exportees - Lignes effectivement écrites (la borne).
 * @param total - Lignes de la source, si on a pu les compter.
 */
export function mentionCoupe(exportees: number, total: number | null): string {
  const surCombien = total !== null ? `sur ${formaterNombre(total)}` : 'sur davantage';
  return `# Export tronqué : ${formaterNombre(exportees)} lignes ${surCombien}, `
    + `les premières par identifiant. La borne de l'export est de ${formaterNombre(BORNE_EXPORT_SOURCE)} lignes.`;
}

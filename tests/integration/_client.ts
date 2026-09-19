import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Le client Supabase des tests d'INTÉGRATION, avec une reprise sur 502.
 *
 * ── LA COURSE SUR LES CONNEXIONS PERSISTANTES ──────────────────────────────
 *
 * Diagnostiqué le 2026-09-19, journaux de Kong à l'appui :
 *
 *     recv() failed (104: Connection reset by peer) while reading response
 *     header from upstream, request: "POST /rest/v1/rpc/lire_couverture_rayon"
 *     "POST /rest/v1/rpc/lire_couverture_rayon HTTP/1.1" 502 75
 *
 * PostgREST ferme une connexion persistante au moment précis où Kong la
 * réutilise. Kong traduit la coupure en **502**, et supabase-js la rend comme
 * « An invalid response was received from the upstream server » — un message
 * qui ne nomme ni Kong, ni les connexions persistantes, ni la course.
 *
 * Le symptôme mentait : un test DIFFÉRENT échouait à chaque exécution, ce qui
 * se lisait comme une régression du test concerné. Aucune erreur n'apparaît
 * dans les journaux de PostgREST — seuls ceux de Kong la portent.
 *
 * ── POURQUOI LA REPRISE EST ICI, ET PAS DANS LE CODE APPLICATIF ───────────
 *
 * C'est une particularité du stack LOCAL. La production Supabase règle ses
 * délais de connexion persistante ; ce n'est pas au produit de compenser une
 * infrastructure de développement. Ajouter une reprise dans `lib/` ferait
 * porter au code une dette qui n'est pas la sienne — et masquerait un vrai 502
 * le jour où il arriverait.
 *
 * ── CE QUE LA REPRISE NE MASQUE PAS ──────────────────────────────────────
 *
 * Elle ne vaut que pour les LECTURES, qui sont idempotentes : rejouer un
 * `select` ou une RPC `stable` ne peut rien casser. Elle ne réessaie QUE sur
 * 502 et 503, jamais sur un 4xx ni sur une erreur applicative — un test qui
 * échoue pour une vraie raison échoue toujours. Et elle ne réessaie qu'UNE
 * fois : deux coupures d'affilée ne sont plus une course, c'est une panne, et
 * on veut la voir.
 *
 * Même distinction que `lib/http/lecture-avec-reprise.ts` face à
 * `lib/http/fetch-avec-delai.ts` : importer l'un ou l'autre EST la déclaration
 * d'idempotence.
 */

// Priorité au local. `dotenv` n'écrase jamais une variable déjà posée :
// l'ordre de ces deux lignes EST le garde-fou.
if (existsSync('.env.development.local')) dotenv.config({ path: '.env.development.local' });
dotenv.config({ path: '.env.local' });

/** Les codes qui signalent la coupure, et eux seuls. */
const REPRENABLES = new Set([502, 503]);

/**
 * Crée le client Supabase des tests d'intégration.
 *
 * @returns Un client `service_role` qui reprend une fois sur 502/503.
 * @throws Si les variables d'environnement sont absentes — mieux vaut un échec
 *   net qu'une suite qui teste le vide.
 *
 * @example
 * const sb = creerClientTest();
 * const { data } = await sb.rpc('lire_couverture_rayon', { p_cible: 'ind' });
 */
export function creerClientTest(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : '
      + 'les tests d’intégration ont besoin de la base locale.',
    );
  }

  const fetchAvecReprise: typeof fetch = async (entree, init) => {
    const premiere = await fetch(entree, init);
    if (!REPRENABLES.has(premiere.status)) return premiere;
    // Une seule reprise, après un souffle : la connexion fautive est fermée,
    // la suivante en ouvrira une neuve.
    await new Promise((r) => setTimeout(r, 120));
    return fetch(entree, init);
  };

  return createClient(url, cle, {
    auth: { persistSession: false },
    global: { fetch: fetchAvecReprise },
  });
}

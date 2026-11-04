/**
 * GET /api/optimisation/algos — le catalogue d'algorithmes du service d'optimisation (plan § 16.1, tâche 2.6).
 *
 * Passerelle : relaie `GET /v1/algos` du service Python par le client unique (`lib/optimisation/client.ts`), réponse
 * validée par Zod (types générés depuis l'OpenAPI). Le service ne lit pas la base pour cette route : le catalogue vit
 * dans son code (`services/optimisation/src/optimisation/algos/registre.py`). Next ne garde AUCUNE copie de la liste.
 *
 * Paramètres : `famille` (`plan` | `correction`) et `proposable` (`true` | `false`), facultatifs.
 * Session : le middleware a validé le JWT (getSession, local) ; `requireAuth` rend le profil — tout rôle connecté
 * peut lire le catalogue (l'écran ⑦ le montre à qui règle la campagne ; le choix, lui, sera contrôlé en 2.7).
 *
 * Erreurs : une défaillance du service n'est jamais masquée — 503 (non configuré, injoignable, indisponible),
 * 504 (délai), 502 (réponse illisible ou refus inattendu), message français de `ErreurOptimisation`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { ErreurOptimisation, lireCatalogueAlgos, type MotifErreur } from '@/lib/optimisation/client';

export const dynamic = 'force-dynamic';

const SchemaFiltres = z.object({
  famille: z.enum(['plan', 'correction'], {
    errorMap: () => ({ message: 'Famille inconnue : « plan » ou « correction » attendu.' }),
  }).optional(),
  proposable: z.enum(['true', 'false'], {
    errorMap: () => ({ message: 'Proposable : « true » ou « false » attendu.' }),
  }).transform((v) => v === 'true').optional(),
}).strict();

const STATUT_PAR_MOTIF: Record<MotifErreur, number> = {
  configuration: 503,
  reseau: 503,
  indisponible: 503,
  delai: 504,
  refus: 502,
  serveur: 502,
  reponse: 502,
};

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const filtres = SchemaFiltres.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!filtres.success) {
    const premiere = filtres.error.issues[0];
    const message = premiere?.code === 'unrecognized_keys'
      ? `Paramètre inconnu : ${premiere.keys.join(', ')}.`
      : premiere?.message ?? 'Paramètres invalides.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const catalogue = await lireCatalogueAlgos(filtres.data);
    return NextResponse.json(catalogue);
  } catch (e) {
    if (e instanceof ErreurOptimisation) {
      return NextResponse.json({ error: e.message, motif: e.motif }, { status: STATUT_PAR_MOTIF[e.motif] });
    }
    throw e;
  }
}

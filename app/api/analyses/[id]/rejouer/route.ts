/**
 * POST /api/analyses/[id]/rejouer
 *
 * Rend de quoi RELANCER une analyse enregistrée : son type, ses paramètres,
 * son maillage, son périmètre, et — quand le moteur correspondant est câblé —
 * l'appel exact à faire pour la rejouer.
 *
 * **N'ÉCRIT RIEN** (corrigé le 2026-09-13, relecture de la tâche 11). La
 * première version insérait une ligne `statut: 'en_cours'` : comme aucun
 * moteur n'était branché dessus, comme la table n'a ni trigger ni timeout et
 * comme l'UI affiche ce statut tel quel, chaque rejeu laissait en base un
 * fantôme « en cours » ÉTERNEL, que rien ne pouvait finir, marquer en échec
 * ni supprimer (aucune UI de suppression). Pire depuis la tâche 12 :
 * `/api/analyses/score` enregistre SON PROPRE lancement, si bien qu'un rejeu
 * suivi d'un vrai calcul produisait un doublon « terminé » plus un orphelin.
 *
 * La ligne est donc écrite par le moteur qui calcule vraiment, au moment où il
 * calcule — c'est déjà ce que font `/api/analyses/score` (tâche 12) et
 * `/api/analyses/correlation` (tâche 13). Cette route dit quoi appeler ; elle
 * ne prétend plus avoir lancé quoi que ce soit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import type { AnalyseEnregistree, TypeAnalyse } from '@/lib/analyses/types';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

/** Comment relancer chaque type d'analyse. `satisfies` force l'exhaustivité :
 *  un type ajouté à `TYPES_ANALYSE` sans entrée ici fait échouer `tsc`. */
const MOTEURS = {
  score:       { cable: true,  endpoint: '/api/analyses/score',       methode: 'POST' },
  correlation: { cable: true,  endpoint: '/api/analyses/correlation', methode: 'GET'  },
  clusters:    { cable: false, endpoint: null, methode: null },
  battle:      { cable: false, endpoint: null, methode: null },
  voronoi:     { cable: false, endpoint: null, methode: null },
  elm:         { cable: false, endpoint: null, methode: null },
} satisfies Record<TypeAnalyse, { cable: boolean; endpoint: string | null; methode: string | null }>;

/**
 * Le Voronoï a été SUPPRIMÉ le 30/10/2026 (décision Vincent) : son type reste admis en base (`TYPES_ANALYSE`, l'historique
 * se consulte), mais une analyse `voronoi` ne se rejoue plus — 410 et une phrase, jamais un moteur `cable: false` qui
 * laisserait croire à un branchement à venir.
 */
const REFUS_VORONOI_SUPPRIME = 'Le Voronoï a été supprimé le 30/10/2026 : cette analyse se consulte mais ne se rejoue plus.';

const RejouerSchema = z.object({
  /** Nom du nouveau lancement. Par défaut : nom de la source + suffixe. */
  nom: z.string().min(1).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  const orgId = profile.organization_id;
  if (!orgId) return NextResponse.json({ error: 'Aucune organisation associée à ce compte.' }, { status: 400 });

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const corps = await lireCorps(request, RejouerSchema, { corpsAbsentTolere: true });
  if (!corps.ok) return NextResponse.json({ error: corps.message }, { status: 400 });

  const supabase = createAdminClient();

  const { data: source, error: lectureErr } = await supabase
    .from('analyses')
    .select('type, nom, parametres, maillage, perimetre')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();

  if (lectureErr) {
    console.error('[POST /api/analyses/[id]/rejouer]', lectureErr.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }
  if (!source) return NextResponse.json({ error: 'Analyse introuvable.' }, { status: 404 });

  // `source.type` sort en `string` du générateur (CHECK non vu) — resserré via
  // `AnalyseEnregistree`, source de vérité `lib/analyses/types.ts`.
  const typeSource = source as Pick<AnalyseEnregistree, 'type' | 'nom' | 'parametres' | 'maillage' | 'perimetre'>;
  if (typeSource.type === 'voronoi') {
    return NextResponse.json({ error: REFUS_VORONOI_SUPPRIME, refus: 'outil_supprime' }, { status: 410 });
  }
  const moteur = MOTEURS[typeSource.type];

  return NextResponse.json({
    rejeu: {
      type: typeSource.type,
      nom: corps.valeur.nom ?? `${source.nom} (rejoué)`,
      parametres: source.parametres,
      maillage: source.maillage,
      perimetre: source.perimetre,
    },
    // `cable: false` n'est pas une erreur : c'est l'état réel des moteurs que
    // les tâches 14 à 22 n'ont pas encore branchés. Le dire explicitement vaut
    // mieux que rendre 201 sur une relance qui n'a pas eu lieu.
    moteur,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

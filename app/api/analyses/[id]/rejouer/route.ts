/**
 * POST /api/analyses/[id]/rejouer
 *
 * Enregistre un NOUVEAU lancement, avec les mêmes `type`/`parametres`/
 * `maillage`/`perimetre` que l'analyse source (scopée à l'org courante).
 * `statut` repart à `en_cours`, `resultat`/`erreur` sont réinitialisés.
 *
 * Portée de cette tâche (11) : cette route rejoue les PARAMÈTRES — elle ne
 * déclenche PAS le moteur de calcul (clustering, bataille, voronoï,
 * corrélation, ELM n'ont ni la même forme d'appel ni le même propriétaire de
 * code, et `isochrone-battle` est un fichier protégé). Le câblage de chaque
 * moteur sur ce rejeu est explicitement la charge des Tâches 12, 13 et 22
 * (voir le brief : « Consommé par les tâches 12, 13, 22 »).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireCorps } from '@/lib/api/valider-corps';
import { toJson } from '@/lib/supabase/rpc-json';
import type { TableInsert } from '@/lib/supabase/tables';
import type { AnalyseEnregistree } from '@/lib/analyses/types';

export const dynamic = 'force-dynamic';

const IdSchema = z.string().uuid();

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

  const ligne: TableInsert<'analyses'> = {
    org_id: orgId,
    created_by: profile.id,
    type: typeSource.type,
    nom: corps.valeur.nom ?? `${source.nom} (rejoué)`,
    parametres: toJson(source.parametres),
    maillage: source.maillage,
    perimetre: source.perimetre ? toJson(source.perimetre) : null,
    resultat: null,
    erreur: null,
    statut: 'en_cours',
  };

  const { data, error } = await supabase.from('analyses').insert(ligne).select().single();
  if (error) {
    console.error('[POST /api/analyses/[id]/rejouer]', error.message);
    return NextResponse.json({ error: 'Erreur base de données.' }, { status: 500 });
  }

  return NextResponse.json({ analyse: data as AnalyseEnregistree }, { status: 201 });
}

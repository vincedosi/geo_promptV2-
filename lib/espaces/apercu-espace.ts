/**
 * lib/espaces/apercu-espace.ts
 * « Ce que voit cet espace » (spec § 4.5).
 *
 * L'aperçu APPELLE la règle des routes — `getOrgSourceIds` sur une session
 * simulée d'un client de cet espace, puis `getCategoriesVisibles` — il ne la
 * recopie pas. S'il la recopiait et qu'elles divergeaient, il mentirait.
 * tests/integration/espaces-apercu.test.ts le confronte à la règle SQL
 * (`source_visible`, sql/234) lue par un VRAI compte client via PostgREST.
 *
 * E4 : pas d'effectif par catégorie (ce serait un COUNT sur poi_france,
 * 390 000 lignes) ; pas de zones ni de jeux de zones (rattachés à un
 * utilisateur, pas à un espace — aucune règle de route ne les compte par
 * espace).
 */
import type { createAdminClient } from '@/lib/auth';
import { getOrgSourceIds } from '@/lib/auth/getOrgSourceIds';
import { getCategoriesVisibles } from '@/lib/poi/categories';
import { lireJeux, sansCles, statutPourEspace } from './donnees-espace';
import type { ApercuEspace } from './types';

type Sb = ReturnType<typeof createAdminClient>;

/** Identifiant fictif de la session simulée — jamais écrit, jamais lu en base. */
const UTILISATEUR_APERCU = 'apercu-espace';

export async function apercuEspace(sb: Sb, orgId: string): Promise<ApercuEspace> {
  const sources = await getOrgSourceIds({ userId: UTILISATEUR_APERCU, orgId, role: 'client' });
  // `null` est réservé au super_admin : impossible ici, le rôle simulé est `client`.
  const visibles = new Set(sources ?? []);
  const jeux = (await lireJeux(sb)).filter((j) => visibles.has(j.id));
  const categories = await getCategoriesVisibles(sources ?? []);

  // dsp_campaigns : table de quelques lignes, COUNT autorisé (jamais poi_france).
  const { count, error } = await sb.from('dsp_campaigns')
    .select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  if (error) throw new Error(`lecture des campagnes : ${error.message}`);

  const garder = (s: 'socle' | 'proprietaire' | 'partage') =>
    jeux.filter((j) => statutPourEspace(j, orgId) === s).map(sansCles);
  return {
    jeux: { socle: garder('socle'), proprietaire: garder('proprietaire'), partage: garder('partage') },
    categories,
    nb_campagnes: count ?? 0,
  };
}

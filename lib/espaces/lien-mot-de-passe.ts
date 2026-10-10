/**
 * lib/espaces/lien-mot-de-passe.ts
 * Générer le lien d'initialisation / de réinitialisation du mot de passe.
 *
 * Il n'y a pas de système d'email dans ce projet : `generateLink` ne fait que
 * GÉNÉRER l'URL, que l'administrateur transmet à la main. C'est le SEUL chemin
 * par lequel un compte créé devient utilisable.
 *
 * Trois routes en génèrent : la création de compte (`POST /api/admin/users`),
 * l'onglet Membres d'un espace (`…/organizations/[id]/members/reset-password`)
 * et la fiche d'un compte (`POST /api/admin/users/[id]/lien-mot-de-passe`).
 * Elles construisaient chacune leur `redirectTo` : il est construit ici, une
 * fois.
 *
 * ⚠ Le `redirectTo` doit figurer dans la liste blanche de GoTrue
 * (`additional_redirect_urls` de `supabase/config.toml` en local, « Redirect
 * URLs » de la console en hébergé). Sinon GoTrue le remplace EN SILENCE par
 * `site_url` : le lien mène à la racine au lieu du formulaire. Constaté le
 * 2026-10-10.
 */
import type { createAdminClient } from '@/lib/auth';

type Sb = ReturnType<typeof createAdminClient>;

/**
 * Origine publique de l'application. `NEXT_PUBLIC_APP_URL` fait autorité ;
 * à défaut, l'origine de la requête (couvre le dev local).
 */
export function origineApplication(urlRequete: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(urlRequete).origin).replace(/\/+$/, '');
}

/**
 * Lien `recovery` vers `<origine>/reset-password`. Ne lève jamais : rend
 * l'erreur de GoTrue, ou `lien: null` s'il n'a rien rendu. Le lien est un
 * secret d'usage unique — jamais journalisé, ni ici ni chez l'appelant.
 */
export async function genererLienMotDePasse(
  sb: Sb,
  email: string,
  origine: string,
): Promise<{ lien: string | null; erreur: string | null }> {
  const { data, error } = await sb.auth.admin.generateLink({
    type: 'recovery',
    email: email.toLowerCase(),
    options: { redirectTo: `${origine}/reset-password` },
  });
  if (error) return { lien: null, erreur: error.message };
  const d = data as { properties?: { action_link?: string } } | null;
  return { lien: d?.properties?.action_link ?? null, erreur: null };
}

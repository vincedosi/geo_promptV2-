/** Traduit un message d'erreur GoTrue en une phrase française. Jamais d'anglais à l'écran. */
export function messageErreurConnexion(brut: string): string {
  if (/invalid login credentials/i.test(brut)) return 'Adresse ou mot de passe incorrect.';
  if (/email not confirmed/i.test(brut)) return 'Ce compte n\'a pas encore été confirmé.';
  if (/failed to fetch|network/i.test(brut)) {
    return 'Le service d\'authentification ne répond pas. La base locale est-elle démarrée ?';
  }
  return 'La connexion a échoué. Réessayez dans un instant.';
}

/**
 * La page où renvoyer après connexion. Un chemin INTERNE seulement : un
 * paramètre `redirection` pointant ailleurs ferait de la page de connexion un
 * tremplin vers un site tiers.
 *
 * Repli : `/app`, l'accueil de l'application en lancement autonome — `/` ne
 * fait que rediriger vers `app` (appRoutes), autant y aller directement.
 */
export const CIBLE_PAR_DEFAUT = '/app';

export function cibleDeRedirection(brut: string | null): string {
  if (!brut || !brut.startsWith('/') || brut.startsWith('//')) return CIBLE_PAR_DEFAUT;
  if (brut === '/connexion' || brut.startsWith('/connexion?')) return CIBLE_PAR_DEFAUT;
  return brut;
}

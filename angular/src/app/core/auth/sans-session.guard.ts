import { Injector, inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { DemarrageService } from '../demarrage/demarrage.service';
import { AuthService } from './auth.service';

/**
 * Page de connexion : un utilisateur déjà connecté n'a rien à y faire. Il part
 * vers `/app` et non `/` : `''` ne fait que rediriger vers `app` (appRoutes).
 *
 * ⚠ Ce garde ATTEND lui-même le démarrage, bien que `demarrageGuard` le
 * précède sur la route : le routeur lance les `canActivate` d'une même route
 * EN MÊME TEMPS, pas l'un après l'autre (mesuré au navigateur le 2026-09-30 :
 * sur un chargement direct de `/connexion`, ce garde lisait AuthService avant
 * que la configuration ne soit là, et la navigation échouait sur « Configuration
 * pas encore chargée »). Les dépendances sont prises AVANT l'`await` — un
 * `inject()` après serait hors contexte (NG0203).
 *
 * Démarrage en échec : on laisse passer SANS toucher à AuthService — son
 * client Supabase se construit sur la configuration, qui n'est pas là. La
 * page affiche alors l'erreur de démarrage (même règle que `authGuard`).
 */
export const sansSessionGuard: CanActivateFn = async () => {
  const demarrage = inject(DemarrageService);
  const injecteur = inject(Injector);
  const router = inject(Router);
  await demarrage.demarrer();
  if (demarrage.erreur()) return true;
  return injecteur.get(AuthService).connecte() ? router.createUrlTree(['/app']) : true;
};

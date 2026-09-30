import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Page de connexion : un utilisateur déjà connecté n'a rien à y faire. Il part
 * vers `/app` et non `/` : `''` ne fait que rediriger vers `app` (appRoutes).
 */
export const sansSessionGuard: CanActivateFn = () =>
  inject(AuthService).connecte() ? inject(Router).createUrlTree(['/app']) : true;

import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

/** Page de connexion : un utilisateur déjà connecté n'a rien à y faire. */
export const sansSessionGuard: CanActivateFn = () =>
  inject(AuthService).connecte() ? inject(Router).createUrlTree(['/']) : true;

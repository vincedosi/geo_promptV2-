import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { DemarrageService } from './demarrage.service';

/** Attend le démarrage ; laisse TOUJOURS passer — RacineDistanteComponent affiche l'erreur. */
export const demarrageGuard: CanActivateFn = async () => {
  await inject(DemarrageService).demarrer();
  return true;
};

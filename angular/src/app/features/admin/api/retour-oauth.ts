import { afterNextRender, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NotificationsService } from '../../../ui/notifications/notifications.service';

/**
 * Retour d'un consentement OAuth (`?oauth=success|error&reason=…`), partagé par DV360 (T9) et
 * TikTok (T10) — ruling T9/T10 : UN seul assistant.
 *
 * React lit `window.location.search` au montage (`dv360/page.tsx:75-80`) et laisse les paramètres
 * dans l'URL (un rechargement rejoue la notification). Ici :
 * - lus dans `ActivatedRoute` (jamais `window.location` : dans un hôte, c'est l'URL du SHELL) ;
 * - même notification, même texte que React (`Échec OAuth : <raison>`, `inconnu` à défaut) ;
 * - puis RETIRÉS (`replaceUrl`, navigation relative à l'écran) : un rechargement ou un retour
 *   arrière ne rejoue plus le message. Défaut React corrigé.
 *
 * Le retrait attend le premier rendu (`afterNextRender`) : naviguer pendant l'activation de la
 * route en cours l'interromprait.
 *
 * À appeler dans un CONTEXTE D'INJECTION (constructeur de l'écran).
 */
export function consommerRetourOAuth(messageSucces: string): void {
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const notifications = inject(NotificationsService);
  const params = route.snapshot.queryParamMap;
  const oauth = params.get('oauth');
  if (oauth === 'success') notifications.success(messageSucces);
  else if (oauth === 'error') notifications.error(`Échec OAuth : ${params.get('reason') ?? 'inconnu'}`);
  if (!params.has('oauth') && !params.has('reason')) return;
  afterNextRender(() => {
    void router.navigate([], {
      relativeTo: route,
      queryParams: { oauth: null, reason: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });
}

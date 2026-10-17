import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BASE_RESSOURCES, urlRessourceDistante } from '../../../core/ressources/ressource-distante';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DspApiLogRow, DspConnectionPublic } from '../logique/types/dsp';
import { DspApi, type ConfigTiktok } from './data/dsp.api';
import { LecturesAnnulables, erreurLueCommeAucuneConnexion, messageEchec, versLigneLog, type LigneLog } from './logique/connexion-dsp';
import { fournisseur } from './logique/fournisseurs';
import { NAVIGUER_HORS_APPLICATION } from './naviguer-hors-application';
import { consommerRetourOAuth } from './retour-oauth';

/**
 * `admin/systeme/api/tiktok` — portage de `app/admin/api/tiktok/page.tsx` (lot 6, T10) : diagnostic
 * de la configuration serveur, App ID + secret de l'app développeur TikTok, OAuth, test,
 * déconnexion, purge, journal des 20 derniers appels TikTok.
 *
 * Même structure que DV360 (T9) mais pas le même formulaire (OAuth seul, App ID au lieu d'un client
 * OAuth + Partner ID) : seul ce qui est identique au pixel est partagé (C16) — `connexion-dsp.css`,
 * `logique/connexion-dsp.ts`, `consommerRetourOAuth`, `NAVIGUER_HORS_APPLICATION`.
 *
 * Écarts à React, voulus (les mêmes que DV360) :
 * - « Se connecter avec TikTok » suit l'URL rendue par `oauth/start` par le jeton (C11).
 * - Retour `?oauth=` : lu dans la route puis retiré de l'URL.
 * - Purge : `mg-confirmation` (`<dialog>`) au lieu de `ConfirmModal` (`position: fixed`), même texte.
 * - Lectures annulées si l'écran est quitté ; écritures menées à terme.
 */
@Component({
  selector: 'mg-tiktok',
  imports: [ConfirmationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tiktok.page.html',
  styleUrls: ['./connexion-dsp.css'],
})
export class TiktokPage {
  private readonly api = inject(DspApi);
  private readonly notifications = inject(NotificationsService);
  private readonly naviguerHors = inject(NAVIGUER_HORS_APPLICATION);

  protected readonly fournisseur = fournisseur('tiktok');
  protected readonly urlLogo = urlRessourceDistante(this.fournisseur.logo, inject(BASE_RESSOURCES));

  protected readonly conn = signal<DspConnectionPublic | null>(null);
  protected readonly config = signal<ConfigTiktok | null>(null);
  private readonly logs = signal<DspApiLogRow[]>([]);
  protected readonly logsBusy = signal(false);
  protected readonly appId = signal('');
  protected readonly appSecret = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmPurge = signal(false);

  private readonly lectures = new LecturesAnnulables();

  protected readonly statut = computed(() => this.conn()?.status ?? 'disconnected');
  protected readonly libelleStatut = computed(() => {
    const s = this.statut();
    return s === 'connected' ? 'Connecté' : s === 'error' ? 'Erreur' : 'Déconnecté';
  });
  /** App prête si saisie par l'organisation OU fournie par l'env (`page.tsx:146`). */
  protected readonly appPrete = computed(() => Boolean(this.conn()?.oauth_client_id || this.config()?.env.app_id));
  /** Testable seulement si un access token existe (`page.tsx:147`). */
  protected readonly peutTester = computed(() => Boolean(this.conn()?.has_credentials));

  protected readonly enregistrerDesactive = computed(() => this.busy() || !this.appId() || !this.appSecret());
  protected readonly oauthDesactive = computed(() => this.busy() || !this.appPrete());
  protected readonly testerDesactive = computed(() => this.busy() || !this.peutTester());

  protected readonly lignesLog = computed<LigneLog[]>(() => this.logs().map(versLigneLog));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lectures.annulerTout());
    // Trois lectures au montage, comme React (`page.tsx:68`) : la limite de 3 en vol est tenue.
    void this.charger();
    void this.chargerConfig();
    void this.chargerLogs();
    consommerRetourOAuth('TikTok connecté — lance « Tester la connexion ».');
  }

  /** `load` (`page.tsx:38-48`). */
  private async charger(): Promise<void> {
    try {
      const json = await this.lectures.lire(this.api.connexions());
      this.appliquerConnexion(json.connections ?? []);
    } catch (e) {
      if (erreurLueCommeAucuneConnexion(e)) {
        this.appliquerConnexion([]);
        return;
      }
      this.notifications.error('Impossible de charger la connexion TikTok.');
    }
  }

  private appliquerConnexion(connexions: DspConnectionPublic[]): void {
    const tt = connexions.find((c) => c.provider === 'tiktok') ?? null;
    this.conn.set(tt);
    if (tt?.oauth_client_id) this.appId.set(tt.oauth_client_id);
  }

  /** `loadConfig` (`page.tsx:50-56`) : en échec, « Diagnostic indisponible. ». */
  private async chargerConfig(): Promise<void> {
    try {
      this.config.set(await this.lectures.lire(this.api.configTiktok()));
    } catch { /* le panneau affichera « Diagnostic indisponible. » */ }
  }

  /** `loadLogs` (`page.tsx:58-66`) : best-effort. */
  protected async chargerLogs(): Promise<void> {
    this.logsBusy.set(true);
    try {
      const json = await this.lectures.lire(this.api.journal({ provider: 'tiktok', limit: 20 }));
      this.logs.set(json.logs ?? []);
    } catch { /* flux de logs best-effort */ } finally {
      this.logsBusy.set(false);
    }
  }

  /** `saveApp` (`page.tsx:78-93`) : le secret est effacé après envoi, jamais relu. */
  protected async enregistrer(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.connecter('tiktok', { app_id: this.appId(), app_secret: this.appSecret() }));
      this.notifications.success('App TikTok enregistrée.');
      this.appSecret.set('');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `startOAuth` (`page.tsx:95-103`) : en cas de succès, on quitte l'application. */
  protected async demarrerOAuth(): Promise<void> {
    this.busy.set(true);
    try {
      const json = await firstValueFrom(this.api.demarrerOAuth('tiktok'));
      if (!json?.url) throw new Error(json?.error ?? 'Erreur');
      this.naviguerHors(json.url); // détour consentement TikTok
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `test` (`page.tsx:105-115`). */
  protected async tester(): Promise<void> {
    this.busy.set(true);
    try {
      const json = await firstValueFrom(this.api.tester('tiktok'));
      this.notifications.success(`Connexion OK — ${json?.advertisers?.length ?? 0} advertisers.`);
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `disconnect` (`page.tsx:117-127`). */
  protected async deconnecter(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deconnecter('tiktok'));
      this.notifications.success('Déconnecté.');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur déconnexion'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `purgeAuth` (`page.tsx:129-142`) : supprime l'app ET le jeton, réinitialise les champs. */
  protected async purger(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deconnecter('tiktok', true));
      this.conn.set(null);
      this.appId.set('');
      this.appSecret.set('');
      this.notifications.success('Données d\'authentification effacées.');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur effacement'));
    } finally {
      this.busy.set(false);
      this.confirmPurge.set(false);
      void this.chargerLogs();
    }
  }

  protected saisir(champ: 'appId' | 'appSecret', e: Event): void {
    this[champ].set((e.target as HTMLInputElement).value);
  }
}

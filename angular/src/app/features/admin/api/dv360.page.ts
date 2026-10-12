import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { firstValueFrom, type Observable, type Subscription } from 'rxjs';
import { BASE_RESSOURCES, urlRessourceDistante } from '../../../core/ressources/ressource-distante';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import type { DspApiLogRow, DspConnectionPublic } from '../logique/types/dsp';
import { DspApi, type ConfigDv360 } from './data/dsp.api';
import { fournisseur } from './logique/fournisseurs';
import { NAVIGUER_HORS_APPLICATION } from './naviguer-hors-application';
import { consommerRetourOAuth } from './retour-oauth';

type Methode = 'service_account' | 'oauth';

/** Une ligne du journal, mise en forme une fois (`LogLine`, `dv360/page.tsx:397-413`). */
interface LigneLog {
  id: string;
  heure: string;
  niveau: string;
  action: string;
  message: string;
  meta: string;
}

/**
 * Message d'une écriture en échec, comme React : `json.error ?? <défaut>` (`dv360/page.tsx:91`…).
 * Un échec réseau donne le `Failed to fetch` du `fetch` de React ; un corps illisible, le défaut
 * (React affichait le message de la `SyntaxError` de `res.json()`).
 */
function messageEchec(e: unknown, defaut: string): string {
  if (e instanceof HttpErrorResponse) {
    const corps = e.error as { error?: unknown } | null;
    if (corps && typeof corps === 'object' && typeof corps.error === 'string' && corps.error) return corps.error;
    return e.status === 0 ? 'Failed to fetch' : defaut;
  }
  return e instanceof Error && e.message ? e.message : defaut;
}

/**
 * `admin/systeme/api/dv360` — portage de `app/admin/api/dv360/page.tsx` (lot 6, T9) : diagnostic de
 * la configuration serveur, méthode (Service Account / OAuth Google), Partner ID, test, déconnexion,
 * purge, journal des 20 derniers appels DV360.
 *
 * DV360 est EN PAUSE (droits Google) : rien ici ne tente un vrai consentement pendant les preuves.
 *
 * Écarts à React, voulus :
 * - « Se connecter avec Google » suit l'URL rendue par `oauth/start` par `NAVIGUER_HORS_APPLICATION`
 *   (C11), jamais `window.location` en direct.
 * - Retour `?oauth=` : lu dans la route puis retiré de l'URL (`consommerRetourOAuth`).
 * - « Effacer les données d'authentification » : `mg-confirmation` (`<dialog>` dans la racine
 *   d'ombre) au lieu de `ConfirmModal` (`position: fixed`), même texte.
 * - Lecture de la connexion en échec RÉSEAU (ou corps illisible) : même notification que React.
 *   Une réponse d'erreur JSON (400 « Aucune organisation… ») laisse, comme React, l'écran « Déconnecté »
 *   sans message — React lisait `json.connections` absent.
 * - Les LECTURES en vol sont annulées si l'écran est quitté ; les ÉCRITURES (connect, purge…) vont
 *   à leur terme, comme le `fetch` de React.
 */
@Component({
  selector: 'mg-dv360',
  imports: [ConfirmationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dv360.page.html',
  // Mise en page en utilitaires Tailwind (gabarit) ; ici, ce qu'ils n'écrivent pas (budget de 4 ko).
  styles: [`
    /* 16 px hérités par React (corps de page) : l’interligne des champs EN LIGNE en dépend. */
    :host { display: block; max-width: 640px; font-family: var(--font-sans); font-size: 16px; color: var(--text-primary); }
    .statut { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--c-statut); }
    .point { width: 7px; height: 7px; border-radius: 50%; background: var(--c-statut); }
    [data-etat='connected'], .prete.ok { --c-statut: var(--success); }
    [data-etat='error'] { --c-statut: var(--danger); }
    [data-etat='disconnected'], .prete:not(.ok) { --c-statut: var(--text-tertiary); }
    .section-tete {
      background: var(--bg-level-2); border: 1px solid var(--border-subtle); border-bottom: none;
      border-radius: 8px 8px 0 0; padding: 10px 14px; display: flex; align-items: center; gap: 8px;
    }
    .section-corps { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-top: none; border-radius: 0 0 8px 8px; }
    .coche { font-family: var(--font-mono); font-size: 12px; width: 14px; color: var(--danger); }
    .coche.ok { color: var(--success); }
    .valeur-config { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary); max-width: 280px; }
    .pretes { display: flex; gap: 16px; margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--border-subtle); }
    .prete { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--c-statut); }
    .encart { background: var(--bg-level-2); border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; }
    .encart.erreur { border: 0.5px solid var(--danger); font-family: var(--font-mono); font-size: 11px; color: var(--danger); }
    .encart.avert { border: 0.5px solid var(--warning); font-size: 12px; color: var(--warning); }
    .carte { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 24px; }
    /* En ligne (inline-block), comme les champs de React : l'interligne compte dans l'espacement. */
    .champ {
      width: 100%; background: var(--bg-level-2); border: 0.5px solid var(--border-subtle);
      border-radius: 6px; padding: 8px 12px; color: var(--text-primary); font-size: 13px; margin: 6px 0 16px;
    }
    .champ:focus { outline: none; border-color: var(--brand-teal-50); }
    .champ::placeholder { color: var(--text-tertiary); }
    .champ.oauth { font-family: var(--font-mono); font-size: 12px; margin-bottom: 12px; }
    .champ.json { font-family: var(--font-mono); font-size: 11px; resize: vertical; }
    .separes { border-top: 0.5px solid var(--border-subtle); padding-top: 16px; }
    .bouton { background: transparent; border-radius: 6px; padding: 8px 16px; font-size: 12px; cursor: pointer; }
    .bouton:disabled, .purge:disabled { opacity: 0.5; }
    .bouton:disabled, .lien:disabled { cursor: not-allowed; }
    .bouton:focus-visible { outline: 1px solid var(--brand-teal-50); outline-offset: 1px; }
    .teal { border: 0.5px solid var(--brand-teal); color: var(--brand-teal); font-weight: 500; }
    .contour { border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .danger { border: 0.5px solid var(--danger); color: var(--danger); }
    .lien { background: transparent; border: none; padding: 0; cursor: pointer; }
    .log { display: flex; gap: 8px; padding: 6px 10px; border-bottom: 0.5px solid var(--border-subtle); font-family: var(--font-mono); font-size: 11px; align-items: baseline; }
    .niveau { color: var(--text-secondary); flex-shrink: 0; text-transform: uppercase; width: 42px; }
    .niveau[data-niveau='error'] { color: var(--danger); }
    .niveau[data-niveau='warn'] { color: var(--warning); }
  `],
})
export class Dv360Page {
  private readonly api = inject(DspApi);
  private readonly notifications = inject(NotificationsService);
  private readonly naviguerHors = inject(NAVIGUER_HORS_APPLICATION);

  protected readonly fournisseur = fournisseur('dv360');
  protected readonly urlLogo = urlRessourceDistante(this.fournisseur.logo, inject(BASE_RESSOURCES));

  protected readonly conn = signal<DspConnectionPublic | null>(null);
  protected readonly config = signal<ConfigDv360 | null>(null);
  private readonly logs = signal<DspApiLogRow[]>([]);
  protected readonly logsBusy = signal(false);
  protected readonly methode = signal<Methode>('service_account');
  protected readonly partnerId = signal('');
  protected readonly saJson = signal('');
  protected readonly clientId = signal('');
  protected readonly clientSecret = signal('');
  protected readonly busy = signal(false);
  protected readonly confirmPurge = signal(false);

  /** Lectures en vol, annulées si l'écran est quitté (les écritures, elles, vont à leur terme). */
  private readonly lectures = new Set<Subscription>();

  protected readonly statut = computed(() => this.conn()?.status ?? 'disconnected');
  protected readonly libelleStatut = computed(() => {
    const s = this.statut();
    return s === 'connected' ? 'Connecté' : s === 'error' ? 'Erreur' : 'Déconnecté';
  });
  /** Testable seulement si des credentials existent réellement (`page.tsx:179`). */
  protected readonly peutTester = computed(() => Boolean(this.conn()?.has_credentials));
  /** OAuth prêt si les variables d'env sont là OU si un client a été saisi (`page.tsx:183`). */
  protected readonly clientOAuthPret = computed(() => Boolean(this.config()?.ready.oauth || this.conn()?.oauth_client_id));
  protected readonly methodePrete = computed(() =>
    this.methode() === 'oauth' ? this.clientOAuthPret() : this.config()?.ready.service_account);
  protected readonly configConnue = computed(() => this.config() !== null);

  protected readonly enregistrerDesactive = computed(() =>
    this.busy() || !this.partnerId() || !this.saJson() || !this.methodePrete());
  protected readonly testerDesactive = computed(() => this.busy() || !this.peutTester());
  protected readonly configOAuthDesactivee = computed(() =>
    this.busy() || !this.partnerId() || !this.clientId() || !this.clientSecret());
  protected readonly oauthDesactive = computed(() => this.busy() || !this.partnerId() || !this.methodePrete());

  protected readonly lignesLog = computed<LigneLog[]>(() => this.logs().map((l) => ({
    id: l.id,
    heure: new Date(l.created_at).toLocaleTimeString('fr-FR'),
    niveau: l.level,
    action: l.action,
    message: l.message ?? '',
    meta: [
      l.status_code != null ? `${l.status_code}` : null,
      l.duration_ms != null ? `${l.duration_ms}ms` : null,
    ].filter(Boolean).join(' · '),
  })));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const s of this.lectures) s.unsubscribe();
      this.lectures.clear();
    });
    // Trois lectures au montage, comme React (`page.tsx:71`) : la limite de 3 en vol est tenue.
    void this.charger();
    void this.chargerConfig();
    void this.chargerLogs();
    consommerRetourOAuth('DV360 connecté via Google.');
  }

  /** Une lecture annulable : la promesse reste en suspens si l'écran est détruit avant la réponse. */
  private lire<T>(source: Observable<T>): Promise<T> {
    return new Promise<T>((resoudre, rejeter) => {
      const s = source.subscribe({
        next: (v) => resoudre(v),
        error: (e: unknown) => { this.lectures.delete(s); rejeter(e); },
        complete: () => this.lectures.delete(s),
      });
      if (!s.closed) this.lectures.add(s);
    });
  }

  /** `load` (`page.tsx:39-51`). */
  private async charger(): Promise<void> {
    try {
      const json = await this.lire(this.api.connexions());
      this.appliquerConnexion(json.connections ?? []);
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status !== 0 && e.error && typeof e.error === 'object') {
        // React : `res.json()` d'une erreur JSON → `json.connections` absent → aucune connexion.
        this.appliquerConnexion([]);
        return;
      }
      this.notifications.error('Impossible de charger la connexion DV360.');
    }
  }

  private appliquerConnexion(connexions: DspConnectionPublic[]): void {
    const dv = connexions.find((c) => c.provider === 'dv360') ?? null;
    this.conn.set(dv);
    if (dv?.partner_id) this.partnerId.set(dv.partner_id);
    if (dv?.oauth_client_id) this.clientId.set(dv.oauth_client_id);
    if (dv?.auth_method === 'service_account' || dv?.auth_method === 'oauth') this.methode.set(dv.auth_method);
  }

  /** `loadConfig` (`page.tsx:53-59`) : en échec, « Diagnostic indisponible. ». */
  private async chargerConfig(): Promise<void> {
    try {
      this.config.set(await this.lire(this.api.configDv360()));
    } catch { /* le panneau affichera « Diagnostic indisponible. » */ }
  }

  /** `loadLogs` (`page.tsx:61-69`) : best-effort. */
  protected async chargerLogs(): Promise<void> {
    this.logsBusy.set(true);
    try {
      const json = await this.lire(this.api.journal({ provider: 'dv360', limit: 20 }));
      this.logs.set(json.logs ?? []);
    } catch { /* flux de logs best-effort */ } finally {
      this.logsBusy.set(false);
    }
  }

  /** `save` (`page.tsx:82-97`). */
  protected async enregistrer(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.connecter('dv360', {
        auth_method: this.methode(), partner_id: this.partnerId(), service_account_json: this.saJson(),
      }));
      this.notifications.success('Connexion enregistrée.');
      this.saJson.set('');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `test` (`page.tsx:99-109`). */
  protected async tester(): Promise<void> {
    this.busy.set(true);
    try {
      const json = await firstValueFrom(this.api.tester('dv360'));
      this.notifications.success(`Connexion OK — ${json?.advertisers?.length ?? 0} advertisers.`);
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `saveOAuthConfig` (`page.tsx:111-126`) : le secret est effacé après envoi, jamais relu. */
  protected async enregistrerConfigOAuth(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.configurerOAuthDv360({
        partner_id: this.partnerId(), oauth_client_id: this.clientId(), oauth_client_secret: this.clientSecret(),
      }));
      this.notifications.success('Config OAuth enregistrée.');
      this.clientSecret.set('');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `startOAuth` (`page.tsx:128-141`) : en cas de succès, on quitte l'application. */
  protected async demarrerOAuth(): Promise<void> {
    if (!this.partnerId()) {
      this.notifications.error('Renseigne le Partner ID avant de connecter Google.');
      return;
    }
    this.busy.set(true);
    try {
      const json = await firstValueFrom(this.api.demarrerOAuth('dv360', { partner_id: this.partnerId() }));
      if (!json?.url) throw new Error(json?.error ?? 'Erreur');
      this.naviguerHors(json.url); // détour consentement Google
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur'));
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `disconnect` (`page.tsx:143-153`). */
  protected async deconnecter(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deconnecter('dv360'));
      this.notifications.success('Déconnecté.');
      await this.charger();
    } catch (e) {
      this.notifications.error(messageEchec(e, 'Erreur déconnexion'));
    } finally {
      this.busy.set(false);
      void this.chargerLogs();
    }
  }

  /** `purgeAuth` (`page.tsx:157-172`) : supprime TOUT et réinitialise les champs. */
  protected async purger(): Promise<void> {
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.deconnecter('dv360', true));
      this.conn.set(null);
      this.partnerId.set('');
      this.clientId.set('');
      this.clientSecret.set('');
      this.saJson.set('');
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

  protected saisir(champ: 'partnerId' | 'saJson' | 'clientId' | 'clientSecret', e: Event): void {
    this[champ].set((e.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}

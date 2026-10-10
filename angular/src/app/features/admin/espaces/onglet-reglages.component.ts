import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ChampComponent } from '../../../ui/champ/champ.component';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi, type OrganisationComplete } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { LONGUEUR_MAX_DESCRIPTION, messageErreur } from './logique/libelles';

/** Résultat de la lecture d'un quota saisi : vide → `null`, entier positif ou nul → le nombre, le reste → refus. */
export type QuotaLu = { ok: true; valeur: number | null } | { ok: false };

/**
 * Lit un quota saisi (« Quota de POI », « Quota de requêtes IA »). Vide → `null` (illimité) ; une
 * suite de chiffres → l'entier ; tout le reste (négatif, décimal, lettres, notation scientifique,
 * espace au milieu, entier hors plage sûre) est REFUSÉ. React se contentait de `parseInt`, qui
 * lisait « 1.5 » comme 1 et « 12abc » comme 12 : un nombre que l'admin n'avait pas tapé.
 */
export function lireQuota(saisie: string): QuotaLu {
  const s = saisie.trim();
  if (s === '') return { ok: true, valeur: null };
  if (!/^\d+$/.test(s)) return { ok: false };
  const n = Number(s);
  return Number.isSafeInteger(n) ? { ok: true, valeur: n } : { ok: false };
}

const MESSAGE_QUOTA = 'Saisissez un entier positif ou nul, ou laissez vide pour ne pas limiter.';

/** Une chaîne de la config lue, ou '' (la valeur peut être absente, `null` ou d'un autre type). */
function texte(config: Record<string, unknown>, cle: string): string {
  const v = config[cle];
  return typeof v === 'string' ? v : '';
}

/** Un quota de la config lue, en saisie. */
function quotaEnSaisie(config: Record<string, unknown>, cle: string): string {
  const v = config[cle];
  return typeof v === 'number' ? String(v) : '';
}

/**
 * Onglet « Réglages » de la fiche d'un espace (spec § 4.6, plan T10) : reprend les champs de
 * `app/admin/organizations/[id]/page.tsx` (supprimée le 2026-10-10, voir dc3c5ee7 ; Nom, Description, quotas, Site Centric) et y ajoute le
 * statut et la suppression.
 *
 * - `espaceId` est un input RÉACTIF : chaque changement relit `GET admin/organizations/:id` et oublie
 *   la saisie. Lecture en échec → message et « Réessayer ».
 * - « Enregistrer » envoie `{ name, description, config }` où `config` est la config LUE, FUSIONNÉE
 *   avec les quatre clés du formulaire : la route REMPLACE la colonne `config` en bloc, d'autres clés
 *   peuvent y vivre. Quota vide → `null`, quota invalide → message en ligne et AUCUN envoi.
 * - « Espace actif » : `PATCH { active }` seul, sans mise à jour optimiste — l'interrupteur ne bouge
 *   qu'après la relecture, un refus le laisse où il était. Désactiver passe par une confirmation ;
 *   l'espace interne n'a pas d'interrupteur (spec § 11).
 * - Une écriture RÉUSSIE notifie, relit puis appelle `etat.recharger()` (le nom et la pastille de la
 *   colonne en dépendent). Tant qu'une écriture ou sa relecture est en vol, tout est désactivé.
 * - Suppression : confirmation `danger` dont les effectifs (membres, jeux privés) viennent de la
 *   LISTE de la page (`EspacesEtatService`), puis `DELETE` et retour (`..`) à la fiche vide. Interdite
 *   sur l'espace interne : le bouton est absent.
 * - La clé Site Centric est un `type="password"` ; elle n'est jamais journalisée ni notifiée.
 */
@Component({
  selector: 'mg-onglet-reglages',
  imports: [ChampComponent, ConfirmationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton neutre" (click)="lire(true)">Réessayer</button>
      </div>
    } @else if (organisation() === null) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else {
      <div class="colonne">
        <section class="section">
          <h3 class="entete"><span class="point"></span>Configuration</h3>
          <div class="corps">
            <mg-champ libelle="Nom">
              <input data-nom type="text" maxlength="200" autocomplete="off" placeholder="Nom de l'espace"
                [value]="nom()" [disabled]="occupe()" (input)="saisir(nom, $event)" />
            </mg-champ>
            @if (erreurNom()) { <p class="erreur-champ" data-erreur-nom>Le nom est obligatoire.</p> }
            <mg-champ libelle="Description">
              <input data-description type="text" [attr.maxlength]="longueurMaxDescription" autocomplete="off" placeholder="Description courte"
                [value]="description()" [disabled]="occupe()" (input)="saisir(description, $event)" />
            </mg-champ>
            <div class="deux">
              <div>
                <mg-champ libelle="Quota de POI (vide = illimité)">
                  <input data-max-poi type="text" inputmode="numeric" autocomplete="off" placeholder="Illimité"
                    [value]="maxPoi()" [disabled]="occupe()" (input)="saisir(maxPoi, $event)" />
                </mg-champ>
                @if (erreurPoi()) { <p class="erreur-champ" data-erreur-poi>{{ messageQuota }}</p> }
              </div>
              <div>
                <mg-champ libelle="Quota de requêtes IA par mois (vide = illimité)">
                  <input data-max-ai type="text" inputmode="numeric" autocomplete="off" placeholder="Illimité"
                    [value]="maxAi()" [disabled]="occupe()" (input)="saisir(maxAi, $event)" />
                </mg-champ>
                @if (erreurAi()) { <p class="erreur-champ" data-erreur-ai>{{ messageQuota }}</p> }
                <p class="note">Disparaîtra avec la suppression de l'IA.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <h3 class="entete"><span class="point"></span>Intégration Site Centric</h3>
          <div class="corps">
            <p class="note">Point d'accès propre à cet espace : ses données ne sont jamais partagées avec les autres.</p>
            <mg-champ libelle="Adresse du point d'accès">
              <input data-site-url type="text" autocomplete="off" placeholder="https://…"
                [value]="siteUrl()" [disabled]="occupe()" (input)="saisir(siteUrl, $event)" />
            </mg-champ>
            <mg-champ libelle="Clé d'API (facultative)">
              <input data-site-cle type="password" autocomplete="new-password" placeholder="Clé d'API"
                [value]="siteCle()" [disabled]="occupe()" (input)="saisir(siteCle, $event)" />
            </mg-champ>
          </div>
        </section>

        <div class="rangee">
          <button type="button" data-enregistrer class="bouton teal" [disabled]="occupe()" (click)="enregistrer()">{{ libelleEnregistrer() }}</button>
        </div>

        <!-- Spec § 11 : l'espace interne porte le socle, son interrupteur « actif » n'est pas offert. -->
        @if (!interne()) {
          <section class="section" data-statut>
            <h3 class="entete"><span class="point"></span>Statut</h3>
            <div class="corps rangee-statut">
              <button
                type="button" role="switch" data-actif class="interrupteur"
                [attr.aria-checked]="actif()" aria-labelledby="etiquette-actif"
                [disabled]="occupe()" (click)="demanderBascule()"
              ><span class="curseur"></span></button>
              <span id="etiquette-actif" class="etiquette-actif">Espace actif</span>
              <span class="note m-0">{{ actif() ? 'Actif' : 'Inactif' }}</span>
            </div>
          </section>
        }

        <section class="danger">
          <div>
            <p class="danger-titre">Zone dangereuse</p>
            @if (interne()) {
              <p class="danger-texte" data-interne>L'espace interne porte les données du socle : il ne se supprime pas.</p>
            } @else {
              <p class="danger-texte">La suppression de l'espace est définitive.</p>
            }
          </div>
          @if (!interne()) {
            <button type="button" data-supprimer class="bouton supprimer" [disabled]="occupe()" (click)="confirmation.set(true)">Supprimer l'espace</button>
          }
        </section>
      </div>
    }

    <mg-confirmation
      [ouvert]="confirmation()"
      [titre]="titreSuppression()"
      [message]="messageSuppression()"
      variante="danger"
      libelleConfirmer="Supprimer l'espace"
      [enCours]="suppression()"
      (confirmer)="supprimer()"
      (annuler)="fermerConfirmation()"
    />

    <mg-confirmation
      data-desactivation
      [ouvert]="confirmationDesactivation()"
      [titre]="titreDesactivation()"
      [message]="messageDesactivation()"
      variante="danger"
      libelleConfirmer="Désactiver l'espace"
      (confirmer)="desactiver()"
      (annuler)="confirmationDesactivation.set(false)"
    />
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); max-width: 640px; }
    .colonne { display: flex; flex-direction: column; gap: 16px; }
    .section { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow: hidden; }
    .entete {
      display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 14px;
      background: var(--bg-level-2); border-bottom: 0.5px solid var(--border-subtle);
      font-size: 12px; font-weight: 500; color: var(--text-primary);
    }
    .point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); }
    .corps { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
    .deux { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    input[type='text'], input[type='password'] {
      width: 100%; box-sizing: border-box;
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); outline: none;
    }
    input::placeholder { color: var(--text-tertiary); }
    input:focus { border-color: var(--brand-teal-50); }
    input:disabled { opacity: 0.6; }
    .note { margin: 4px 0 0; font-size: 11px; color: var(--text-tertiary); }
    .erreur-champ { margin: 0; font-size: 12px; color: var(--danger); }
    .rangee { display: flex; align-items: center; gap: 12px; }
    .rangee-statut { flex-direction: row; align-items: center; }
    .etiquette-actif { font-size: 13px; color: var(--text-primary); }
    .interrupteur {
      position: relative; width: 34px; height: 20px; flex-shrink: 0; padding: 0; cursor: pointer;
      border-radius: 10px; border: 0.5px solid var(--border-default); background: var(--bg-level-3);
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover);
    }
    .curseur {
      position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: var(--text-tertiary); transition: transform 150ms var(--ease-hover), background-color 150ms var(--ease-hover);
    }
    .interrupteur[aria-checked='true'] { background: var(--brand-teal); border-color: var(--brand-teal); }
    .interrupteur[aria-checked='true'] .curseur { transform: translateX(14px); background: var(--brand-teal-fg); }
    .interrupteur:disabled { opacity: 0.5; cursor: not-allowed; }
    .interrupteur:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .bouton {
      flex-shrink: 0; border-radius: 6px; padding: 8px 16px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .bouton:disabled { cursor: not-allowed; opacity: 0.5; }
    .neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .teal:not(:disabled):hover { background: var(--brand-teal-10); }
    .supprimer { background: transparent; border: 0.5px solid var(--danger); color: var(--danger); }
    .supprimer:not(:disabled):hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
    .danger {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 14px; border-radius: 8px;
      border: 0.5px solid color-mix(in srgb, var(--danger) 30%, transparent);
    }
    .danger-titre { margin: 0; font-size: 12px; font-weight: 500; color: var(--danger); }
    .danger-texte { margin: 2px 0 0; font-size: 12px; color: var(--text-tertiary); }
    .squelette { height: 36px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    @media (prefers-reduced-motion: reduce) { .squelette, .interrupteur, .curseur { animation: none; transition: none; } }
  `,
})
export class OngletReglagesComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly espaceId = input.required<string>();

  protected readonly messageQuota = MESSAGE_QUOTA;
  protected readonly longueurMaxDescription = LONGUEUR_MAX_DESCRIPTION;

  /** Ce que le serveur a rendu à la dernière lecture : la config à FUSIONNER, et l'état « actif ». */
  protected readonly organisation = signal<OrganisationComplete | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected readonly nom = signal('');
  protected readonly description = signal('');
  protected readonly maxPoi = signal('');
  protected readonly maxAi = signal('');
  protected readonly siteUrl = signal('');
  protected readonly siteCle = signal('');

  protected readonly erreurNom = signal(false);
  protected readonly erreurPoi = signal(false);
  protected readonly erreurAi = signal(false);

  protected readonly confirmation = signal(false);
  protected readonly suppression = signal(false);
  protected readonly confirmationDesactivation = signal(false);
  private readonly ecriture = signal(false);
  /** Une relecture qui suit une écriture est en vol : les valeurs affichées peuvent être périmées. */
  private readonly relecture = signal(false);
  /** Écriture OU relecture post-écriture OU suppression : rien d'autre n'est permis. */
  protected readonly occupe = computed(() => this.ecriture() || this.relecture() || this.suppression());

  protected readonly actif = computed(() => this.organisation()?.active ?? false);
  private readonly resume = computed(() => this.etat.espaces().find((e) => e.id === this.espaceId()) ?? null);
  protected readonly interne = computed(() => this.resume()?.interne ?? false);
  protected readonly libelleEnregistrer = computed(() => (this.ecriture() ? 'Enregistrement…' : 'Enregistrer'));

  protected readonly titreSuppression = computed(() => `Supprimer ${this.resume()?.nom_affiche ?? 'cet espace'} ?`);
  protected readonly messageSuppression = computed(() => {
    const r = this.resume();
    if (!r) return '';
    const n = r.nb_membres;
    const m = r.nb_jeux_prives;
    const membres = n === 1 ? 'Son 1 membre en est retiré' : `Ses ${n} membres en sont retirés`;
    const jeux = m === 1 ? 'son 1 jeu privé devient sans propriétaire et n\'est' : `ses ${m} jeux privés deviennent sans propriétaire et ne sont`;
    return `${membres} ; ${jeux} plus visible${m === 1 ? '' : 's'} que du super-administrateur.`;
  });

  protected readonly titreDesactivation = computed(() => `Désactiver ${this.resume()?.nom_affiche ?? 'cet espace'} ?`);
  protected readonly messageDesactivation = computed(() => {
    const n = this.resume()?.nb_membres;
    // Ce que les routes font d'un espace inactif (`admin/users`, `admin/campaigns/[id]`) : plus de
    // nouveau compte, plus de campagne rattachée. Rien n'est supprimé.
    const qui = n === undefined ? 'Ses membres' : n === 1 ? 'Son 1 membre' : `Ses ${n} membres`;
    return `Un espace inactif n'accepte plus de nouveau compte ni de campagne. ${qui} y ${n === 1 ? 'est' : 'sont'} concerné${n === 1 ? '' : 's'}. Rien n'est supprimé : le réactiver suffit.`;
  });

  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;

  constructor() {
    // Lecture à chaque changement d'espace (input réactif) ; tout le reste hors suivi.
    effect(() => {
      this.espaceId();
      untracked(() => {
        this.envoi?.unsubscribe();
        this.organisation.set(null);
        this.ecriture.set(false);
        this.relecture.set(false);
        this.suppression.set(false);
        this.confirmation.set(false);
        this.lire(true);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.envoi?.unsubscribe();
    });
  }

  /**
   * `GET admin/organizations/:id`. `remplir` : recopie aussi la config dans le formulaire (lecture
   * initiale, relecture après un enregistrement) ; après une simple bascule d'activité, la saisie en
   * cours n'est pas touchée. Une relecture qui échoue garde l'écran et le notifie.
   */
  protected lire(remplir: boolean): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.lecture = this.api.lireEspace(this.espaceId()).subscribe({
      next: ({ organization }) => {
        this.organisation.set(organization);
        if (remplir) this.remplir(organization);
        this.relecture.set(false);
      },
      error: (e: unknown) => {
        this.relecture.set(false);
        if (this.organisation() === null) this.erreur.set(messageErreur(e));
        else this.notifications.error(messageErreur(e));
      },
    });
  }

  private remplir(o: OrganisationComplete): void {
    const config = o.config ?? {};
    this.nom.set(o.name);
    this.description.set(o.description ?? '');
    this.maxPoi.set(quotaEnSaisie(config, 'max_poi'));
    this.maxAi.set(quotaEnSaisie(config, 'max_ai_requests'));
    this.siteUrl.set(texte(config, 'site_centric_url'));
    this.siteCle.set(texte(config, 'site_centric_key'));
    this.erreurNom.set(false);
    this.erreurPoi.set(false);
    this.erreurAi.set(false);
  }

  protected saisir(champ: { set(v: string): void }, e: Event): void {
    champ.set((e.target as HTMLInputElement).value);
    // Une saisie corrige : le message d'un envoi refusé disparaît avec elle.
    this.erreurNom.set(false);
    this.erreurPoi.set(false);
    this.erreurAi.set(false);
  }

  protected enregistrer(): void {
    const o = this.organisation();
    if (!o || this.occupe()) return;
    const nom = this.nom().trim();
    const poi = lireQuota(this.maxPoi());
    const ai = lireQuota(this.maxAi());
    this.erreurNom.set(nom === '');
    this.erreurPoi.set(!poi.ok);
    this.erreurAi.set(!ai.ok);
    if (nom === '' || !poi.ok || !ai.ok) return;

    this.ecrire(
      this.api.modifierEspace(this.espaceId(), {
        name: nom,
        description: this.description().trim() || null,
        config: {
          ...(o.config ?? {}),
          site_centric_url: this.siteUrl().trim() || null,
          site_centric_key: this.siteCle().trim() || null,
          max_poi: poi.valeur,
          max_ai_requests: ai.valeur,
        },
      }),
      'Réglages enregistrés',
      nom,
      true,
    );
  }

  /**
   * Clic sur l'interrupteur. Activer part tout de suite ; DÉSACTIVER coupe l'accès de tous les
   * membres, il passe donc par une confirmation.
   */
  protected demanderBascule(): void {
    if (!this.organisation() || this.occupe() || this.interne()) return;
    if (this.actif()) this.confirmationDesactivation.set(true);
    else this.basculer();
  }

  protected desactiver(): void {
    this.confirmationDesactivation.set(false);
    if (this.actif()) this.basculer();
  }

  /** Bascule l'activité : `PATCH { active }` seul ; l'interrupteur ne bouge qu'après la relecture. */
  private basculer(): void {
    // Spec § 11 : jamais sur l'espace interne, même si l'interrupteur venait à être offert.
    if (!this.organisation() || this.occupe() || this.interne()) return;
    const futur = !this.actif();
    this.ecrire(this.api.modifierEspace(this.espaceId(), { active: futur }), futur ? 'Espace activé' : 'Espace désactivé', this.nom().trim() || undefined, false);
  }

  private ecrire(requete: ReturnType<EspacesApi['modifierEspace']>, succes: string, detail: string | undefined, remplir: boolean): void {
    this.ecriture.set(true);
    this.envoi = requete.subscribe({
      next: () => {
        this.ecriture.set(false);
        this.notifications.success(succes, detail);
        this.relecture.set(true);
        this.lire(remplir);
        this.etat.recharger();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.notifications.error(messageErreur(e));
      },
    });
  }

  protected fermerConfirmation(): void {
    if (!this.suppression()) this.confirmation.set(false);
  }

  protected supprimer(): void {
    if (this.occupe() || this.interne()) return;
    this.suppression.set(true);
    const nom = this.resume()?.nom_affiche;
    this.envoi = this.api.supprimerEspace(this.espaceId()).subscribe({
      next: () => {
        this.notifications.success('Espace supprimé', nom);
        this.etat.recharger();
        // Fiche vide : `..` depuis `…/espaces/:id` mène à `…/espaces`. Le composant est détruit
        // avec la navigation, l'état local n'a donc rien à remettre à zéro.
        void this.router.navigate(['..'], { relativeTo: this.route });
      },
      error: (e: unknown) => {
        this.suppression.set(false);
        this.confirmation.set(false);
        this.notifications.error(messageErreur(e));
      },
    });
  }
}

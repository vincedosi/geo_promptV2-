import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { ChampComponent } from '../../../ui/champ/champ.component';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { EspacesApi, type OrganisationComplete } from './data/espaces.api';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { LONGUEUR_MAX_GROUPE, groupesDesAutres } from './logique/groupes';
import { LONGUEUR_MAX_DESCRIPTION, messageErreur } from './logique/libelles';
import {
  MESSAGE_QUOTA, lireQuota, messageDesactivation, messageSuppression, quotaEnSaisie, texteDeConfig,
} from './logique/reglages';

/**
 * Onglet « Réglages » de la fiche d'un espace (spec § 4.6, plan T10) : reprend les champs de
 * `app/admin/organizations/[id]/page.tsx` (supprimée le 2026-10-10, voir dc3c5ee7 ; Nom, Description, quotas, Site Centric) et y ajoute le
 * statut et la suppression.
 *
 * - `espaceId` est un input RÉACTIF : chaque changement relit `GET admin/organizations/:id` et oublie
 *   la saisie. Lecture en échec → message et « Réessayer ».
 * - « Groupe » (lot « Catalogue et groupes », A-9, option A) : un nom libre, prérempli, avec en
 *   suggestions (`<datalist>`) les groupes des autres espaces ; vide → `null`. Envoyé par
 *   « Enregistrer » avec le reste. Range la colonne d'Accès, ne porte aucun droit.
 * - « Enregistrer » envoie `{ name, description, groupe_espace, config }` où `config` est la config LUE, FUSIONNÉE
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
  templateUrl: './onglet-reglages.component.html',
  styleUrls: ['./fiche-commune.css', './onglet-reglages.component.css'],
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
  protected readonly longueurMaxGroupe = LONGUEUR_MAX_GROUPE;

  /** Ce que le serveur a rendu à la dernière lecture : la config à FUSIONNER, et l'état « actif ». */
  protected readonly organisation = signal<OrganisationComplete | null>(null);
  protected readonly erreur = signal<string | null>(null);

  protected readonly nom = signal('');
  protected readonly description = signal('');
  protected readonly groupe = signal('');
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
  /** Suggestions du champ « Groupe » : les groupes des AUTRES espaces, tirés de la liste déjà lue (aucun appel). */
  protected readonly suggestionsGroupe = computed(() => groupesDesAutres(this.etat.espaces(), this.espaceId()));
  protected readonly libelleEnregistrer = computed(() => (this.ecriture() ? 'Enregistrement…' : 'Enregistrer'));

  protected readonly titreSuppression = computed(() => `Supprimer ${this.resume()?.nom_affiche ?? 'cet espace'} ?`);
  protected readonly messageSuppression = computed(() => {
    const r = this.resume();
    return r ? messageSuppression(r.nb_membres, r.nb_jeux_prives) : '';
  });

  protected readonly titreDesactivation = computed(() => `Désactiver ${this.resume()?.nom_affiche ?? 'cet espace'} ?`);
  protected readonly messageDesactivation = computed(() => messageDesactivation(this.resume()?.nb_membres));

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
    this.groupe.set(o.groupe_espace ?? '');
    this.maxPoi.set(quotaEnSaisie(config, 'max_poi'));
    this.maxAi.set(quotaEnSaisie(config, 'max_ai_requests'));
    this.siteUrl.set(texteDeConfig(config, 'site_centric_url'));
    this.siteCle.set(texteDeConfig(config, 'site_centric_key'));
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
        // Vide → `null` : l'espace sort de son groupe (le serveur refuse une chaîne vide).
        groupe_espace: this.groupe().trim() || null,
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

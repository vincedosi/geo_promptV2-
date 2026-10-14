import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { ConfirmationComponent } from '../../../ui/confirmation/confirmation.component';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { EspacesApi } from './data/espaces.api';
import { type Choix, DialogueTransfertComponent } from './dialogue-transfert.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { JeuxRecommandesComponent } from './jeux-recommandes.component';
import { LIBELLES_STATUT, LIBELLES_TYPE, messageErreur } from './logique/libelles';
import type { JeuPourEspace, ReponseDonneesEspace, StatutJeu } from './logique/types';

/** Une ligne de tableau, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneJeu {
  id: string;
  nom: string;
  type: string;
  categorie: string;
  lignes: string;
  statut: StatutJeu;
  libelleStatut: string;
}

type Intention = 'transfert' | 'socle' | 'retrait';

interface Cible {
  intention: Intention;
  jeu: JeuPourEspace;
  vers: Choix | null;
}

/**
 * Onglet « Données » de la fiche d'un espace (spec § 4.4, plan T8) : les jeux, tels que CET espace
 * les voit, et les gestes du super_admin pour changer cette vue ; puis la sélection recommandée sur
 * la carte (`mg-jeux-recommandes`, spec carte-en-parcours § 7.2), rendue quel que soit l'état du tableau.
 *
 * - `espaceId` est un input RÉACTIF (la fiche réutilise l'onglet d'un espace à l'autre) : chaque
 *   changement relit `GET admin/espaces/:id/donnees` et abandonne la lecture en vol. Le tri est celui
 *   du serveur (propriétaire, partagé, socle, non visible), conservé tel quel.
 * - Propriétaire : « Transférer… » (dialogue des AUTRES espaces, puis confirmation nommant les deux)
 *   → `PATCH admin/sources/:id { organization_id }` ; « Mettre au socle » → confirmation →
 *   `PATCH { visibilite: 'socle' }`. Partagé : « Retirer le partage » → confirmation `danger` →
 *   `DELETE …/sources/assign`. Non visible : « Partager avec cet espace » → `POST …/sources/assign`,
 *   sans confirmation (réversible, n'ôte rien à personne). Socle : aucune action, un lien relatif
 *   vers la fiche Socle.
 * - Aucune mise à jour optimiste : après une écriture RÉUSSIE seulement, notification, relecture de
 *   l'onglet et `etat.recharger()` (les compteurs de jeux privés changent). Un échec notifie le
 *   message du serveur et laisse le tableau tel quel.
 */
@Component({
  selector: 'mg-onglet-donnees',
  imports: [RouterLink, ConfirmationComponent, IconeComponent, Cellule, EnteteCellule, DialogueTransfertComponent, JeuxRecommandesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton-neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (reponse() === null) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else if (lignes().length === 0) {
      <p class="vide">Aucun jeu de données.</p>
    } @else {
      <div class="cadre">
        <table class="w-full border-collapse text-[12px]">
          <thead>
            <tr class="border-b-fin border-default">
              <th mgTh alignement="gauche">Jeu</th>
              <th mgTh alignement="gauche">Type</th>
              <th mgTh alignement="gauche">Catégorie</th>
              <th mgTh>Lignes</th>
              <th mgTh alignement="gauche">Statut</th>
              <th mgTh><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (l of lignes(); track l.id) {
              <tr class="border-b-fin border-subtle" [attr.data-jeu]="l.id">
                <td mgTd alignement="gauche" fort class="!font-sans !text-[12px]">{{ l.nom }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ l.type }}</td>
                <td mgTd alignement="gauche" class="!font-sans !text-[12px]">{{ l.categorie }}</td>
                <td mgTd>{{ l.lignes }}</td>
                <td mgTd alignement="gauche" class="!font-sans">
                  <span class="statut" [class]="'statut ' + l.statut">
                    @if (l.statut === 'socle') {
                      <mg-icone nom="cadenas" [taille]="11" />
                    }
                    {{ l.libelleStatut }}
                  </span>
                </td>
                <td mgTd>
                  <span class="actions">
                    @switch (l.statut) {
                      @case ('proprietaire') {
                        <button type="button" class="bouton-neutre" [attr.data-action]="l.id" [disabled]="occupe()" (click)="demander(l.id, 'transfert')">Transférer…</button>
                        <button type="button" class="bouton-teal" [attr.data-socle]="l.id" [disabled]="occupe()" (click)="demander(l.id, 'socle')">Mettre au socle</button>
                      }
                      @case ('partage') {
                        <button type="button" class="bouton-neutre" [attr.data-action]="l.id" [disabled]="occupe()" (click)="demander(l.id, 'retrait')">Retirer le partage</button>
                      }
                      @case ('socle') {
                        <span class="attenue">Se règle dans le <a routerLink="../socle" class="lien">socle</a></span>
                      }
                      @case ('non_visible') {
                        <button type="button" class="bouton-teal" [attr.data-action]="l.id" [disabled]="occupe()" (click)="partager(l.id)">Partager avec cet espace</button>
                      }
                    }
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <!-- Toujours rendu, quel que soit l'état du tableau : il a sa propre lecture. -->
    <mg-jeux-recommandes [espaceId]="espaceId()" />

    @if (transfert(); as j) {
      <mg-dialogue-transfert [nomJeu]="j.nom" [espaces]="autresEspaces()" (choisir)="choisirCible($event)" (annuler)="transfert.set(null)" />
    }

    <mg-confirmation
      [ouvert]="cible() !== null"
      [titre]="titreConfirmation()"
      [message]="messageConfirmation()"
      [variante]="cible()?.intention === 'retrait' ? 'danger' : 'defaut'"
      [libelleConfirmer]="libelleConfirmer()"
      [enCours]="ecriture()"
      (confirmer)="confirmer()"
      (annuler)="fermer()"
    />
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .cadre { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow-x: auto; }
    .vide { margin: 0; padding: 12px 14px; font-size: 12px; color: var(--text-tertiary); }
    .statut {
      display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 4px; white-space: nowrap;
      background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); font-size: 10px;
    }
    /* Le bord porte le sens ; le texte garde le contraste de --text-secondary dans les deux thèmes. */
    .statut.proprietaire { border-color: var(--brand-teal); }
    .statut.partage { border-color: var(--info); }
    .statut.socle, .statut.non_visible { border-color: var(--text-tertiary); }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 6px; }
    .attenue { font-family: var(--font-sans); font-size: 11px; color: var(--text-tertiary); }
    .lien { color: var(--brand-teal); text-decoration: none; }
    .lien:hover { text-decoration: underline; }
    .lien:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .bouton-neutre, .bouton-teal {
      border-radius: 6px; padding: 5px 12px; font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton-neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .bouton-neutre:not(:disabled):hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
    .bouton-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); }
    .bouton-teal:not(:disabled):hover { background: var(--brand-teal-10); }
    .bouton-neutre:disabled, .bouton-teal:disabled { opacity: 0.5; cursor: not-allowed; }
    .bouton-neutre:focus-visible, .bouton-teal:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .squelette { height: 36px; margin-bottom: 8px; border-radius: 6px; background: var(--bg-level-2); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .erreur {
      display: flex; flex-direction: column; gap: 10px; align-items: flex-start;
      padding: 12px; border-radius: 6px; font-size: 12px; color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
      border: 0.5px solid color-mix(in srgb, var(--danger) 20%, transparent);
    }
    @media (prefers-reduced-motion: reduce) { .squelette { animation: none; } }
  `,
})
export class OngletDonneesComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);

  readonly espaceId = input.required<string>();

  /** `null` tant que la première lecture n'a pas répondu. */
  protected readonly reponse = signal<ReponseDonneesEspace | null>(null);
  protected readonly erreur = signal<string | null>(null);
  /** Le jeu dont on choisit le nouvel espace (dialogue « Transférer… »). */
  protected readonly transfert = signal<JeuPourEspace | null>(null);
  /** Ce qui attend une confirmation. */
  protected readonly cible = signal<Cible | null>(null);
  protected readonly ecriture = signal(false);
  /** Une relecture qui suit une écriture est en vol : les lignes affichées peuvent être périmées. */
  private readonly relecture = signal(false);
  /** Écriture OU relecture post-écriture en cours : aucune action n'est permise sur des lignes périmées. */
  protected readonly occupe = computed(() => this.ecriture() || this.relecture());

  private lecture: Subscription | null = null;
  private envoi: Subscription | null = null;

  private readonly nomsEspaces = computed(() => new Map(this.etat.espaces().map((e) => [e.id, e.nom_affiche])));
  private readonly nomEspace = computed(() => this.nomsEspaces().get(this.espaceId()) ?? '');

  protected readonly autresEspaces = computed<Choix[]>(() =>
    this.etat.espaces().filter((e) => e.id !== this.espaceId()).map((e) => ({ id: e.id, nom: e.nom_affiche, inactif: !e.actif })),
  );

  protected readonly lignes = computed<LigneJeu[]>(() =>
    (this.reponse()?.jeux ?? []).map((j) => ({
      id: j.id,
      nom: j.nom,
      type: LIBELLES_TYPE[j.type],
      categorie: j.categorie ?? '—',
      lignes: formaterNombre(j.nb_lignes),
      statut: j.statut,
      libelleStatut: LIBELLES_STATUT[j.statut],
    })),
  );

  protected readonly titreConfirmation = computed(() => {
    const c = this.cible();
    if (!c) return '';
    if (c.intention === 'socle') return `Mettre « ${c.jeu.nom} » au socle ?`;
    if (c.intention === 'retrait') return `Retirer le partage de « ${c.jeu.nom} » ?`;
    return `Transférer « ${c.jeu.nom} » à ${c.vers?.nom ?? ''} ?`;
  });

  protected readonly messageConfirmation = computed(() => {
    const c = this.cible();
    if (!c) return '';
    const ici = this.nomEspace();
    if (c.intention === 'socle') return 'Il sera visible de tous les espaces clients.';
    if (c.intention === 'retrait') return `${ici} ne verra plus « ${c.jeu.nom} ».`;
    return `« ${c.jeu.nom} » passera de ${ici} à ${c.vers?.nom ?? ''}. ${ici} ne le verra plus, sauf partage.`;
  });

  protected readonly libelleConfirmer = computed(() => {
    const i = this.cible()?.intention;
    return i === 'retrait' ? 'Retirer le partage' : i === 'transfert' ? 'Transférer' : 'Mettre au socle';
  });

  constructor() {
    // Lecture à chaque changement d'espace (input réactif) ; la lecture elle-même hors suivi.
    effect(() => {
      this.espaceId();
      untracked(() => {
        this.reponse.set(null);
        this.relecture.set(false);
        this.transfert.set(null);
        this.cible.set(null);
        this.lire();
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.lecture?.unsubscribe();
      this.envoi?.unsubscribe();
    });
  }

  /** `GET admin/espaces/:id/donnees`. Une relecture qui échoue garde le tableau et le notifie. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.lecture = this.api.lireDonnees(this.espaceId()).subscribe({
      next: (r) => {
        this.reponse.set(r);
        this.relecture.set(false);
      },
      error: (e: unknown) => {
        this.relecture.set(false);
        if (this.reponse() === null) this.erreur.set(messageErreur(e));
        else this.notifications.error(messageErreur(e));
      },
    });
  }

  private jeu(id: string): JeuPourEspace | undefined {
    return this.reponse()?.jeux.find((j) => j.id === id);
  }

  protected demander(id: string, intention: Intention): void {
    const jeu = this.jeu(id);
    if (!jeu || this.occupe()) return;
    if (intention === 'transfert') this.transfert.set(jeu);
    else this.cible.set({ intention, jeu, vers: null });
  }

  /** Un espace choisi dans le dialogue : on passe à la confirmation qui nomme les deux espaces. */
  protected choisirCible(id: string): void {
    const jeu = this.transfert();
    const vers = this.autresEspaces().find((e) => e.id === id);
    this.transfert.set(null);
    if (jeu && vers) this.cible.set({ intention: 'transfert', jeu, vers });
  }

  protected fermer(): void {
    if (!this.ecriture()) this.cible.set(null);
  }

  protected confirmer(): void {
    const c = this.cible();
    if (!c || this.occupe()) return;
    const id = c.jeu.id;
    if (c.intention === 'retrait') {
      this.ecrire(this.api.retirerPartage(this.espaceId(), id), 'Partage retiré', c.jeu.nom);
    } else if (c.intention === 'socle') {
      this.ecrire(this.api.modifierJeu(id, { visibilite: 'socle' }), 'Jeu mis au socle', c.jeu.nom);
    } else if (c.vers) {
      this.ecrire(this.api.modifierJeu(id, { organization_id: c.vers.id }), 'Jeu transféré', c.jeu.nom);
    }
  }

  /** « Partager avec cet espace » : sans confirmation, l'écriture est réversible. */
  protected partager(id: string): void {
    const jeu = this.jeu(id);
    if (!jeu || this.occupe()) return;
    this.ecrire(this.api.partager(this.espaceId(), id), 'Jeu partagé', jeu.nom);
  }

  private ecrire(requete: ReturnType<EspacesApi['partager']>, succes: string, detail: string): void {
    this.ecriture.set(true);
    this.envoi = requete.subscribe({
      next: () => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.success(succes, detail);
        this.relecture.set(true);
        this.lire();
        this.etat.recharger();
      },
      error: (e: unknown) => {
        this.ecriture.set(false);
        this.cible.set(null);
        this.notifications.error(messageErreur(e));
        // Le serveur n'écrit pas de façon atomique (le transfert peut déplacer la propriété puis échouer
        // sur les POI) : après un refus, le tableau a pu changer. On relit, sans `etat.recharger()`.
        this.relecture.set(true);
        this.lire();
      },
    });
  }
}

import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../core/format/nombre';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { Cellule, EnteteCellule } from '../../../ui/tableau/cellules';
import { ROLE_LABELS } from '../logique/roles';
import { EspacesApi } from './data/espaces.api';
import { DialogueCreationCompteComponent } from './dialogue-creation-compte.component';
import { EspacesEtatService } from './etat/espaces-etat.service';
import { FicheUtilisateurComponent } from './fiche-utilisateur.component';
import { filtrerComptes, grouperComptes } from './logique/comptes';
import { messageErreur } from './logique/libelles';
import type { CompteResume, MembreEspace } from './logique/types';

/** Une ligne du tableau, prête pour le gabarit (aucun calcul dans le gabarit). */
interface LigneCompte {
  id: string;
  nom: string;
  email: string;
  role: string;
  espaces: { id: string; nom: string; actif: boolean }[];
  creeLe: string;
  aria: string;
}

interface GroupeAffiche {
  cle: string;
  libelle: string;
  effectif: string;
  lignes: LigneCompte[];
}

const TIRET = '—';

function dateFr(iso: string | null): string {
  if (!iso) return TIRET;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? TIRET : d.toLocaleDateString('fr-FR');
}

/**
 * Vue « Tous les comptes » de la page Accès (`admin/acces/comptes`, 2026-10-10). Elle reprend ce
 * que seule la page React Users (`app/admin/users/page.tsx`, supprimée le 2026-10-10, voir dc3c5ee7) offrait : la liste de TOUS les comptes,
 * y compris les super_admin et les comptes rattachés à aucun espace — invisibles depuis l'onglet
 * Membres d'un espace.
 *
 * - UN `GET admin/espaces/comptes` à l'ouverture de la vue, puis cache : il n'est relu qu'après une
 *   écriture réussie (fiche fermée sur `true`, compte créé), avec les compteurs de la colonne
 *   (`etat.recharger()` : nombre de comptes, membres par espace).
 * - Regroupement de React (`grouperComptes`, testé à part) : Super admins, un groupe par espace
 *   actif, « Sans espace » en dernier. Filtre LOCAL nom/email, sans accents ni casse : aucun appel.
 * - Rôle en badge du design system, PAS les couleurs rouge/orange/bleu de React (`ROLE_COLORS`), qui
 *   sortent de la charte (écart consigné, spec § 11).
 * - Clic sur une ligne → la fiche utilisateur existante, SANS espace courant : ses cases viennent
 *   de la liste complète des espaces du compte. Au clavier, le NOM est un vrai `<button>` (rôle
 *   accessible, Entrée ET Espace natifs) dont le clic remonte à la ligne ; la ligne elle-même
 *   n'est plus focalisable (2026-10-10, relecture de T1).
 */
@Component({
  selector: 'mg-vue-comptes',
  imports: [Cellule, EnteteCellule, FicheUtilisateurComponent, DialogueCreationCompteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="entete">
      <div>
        <h2 class="m-0 text-[16px] font-medium text-primary">Tous les comptes</h2>
        <p class="mb-0 mt-1 text-[13px] text-secondary">Chaque compte, regroupé par espace actif. Un compte rattaché à aucun espace n'apparaît qu'ici.</p>
      </div>
      <button type="button" data-creer-compte class="bouton principal" (click)="creationOuverte.set(true)">Créer un compte</button>
    </header>

    @if (erreur(); as message) {
      <div role="alert" class="erreur">
        <p class="m-0">{{ message }}</p>
        <button type="button" data-reessayer class="bouton neutre" (click)="lire()">Réessayer</button>
      </div>
    } @else if (comptes() === null) {
      @for (i of [1, 2, 3]; track i) {
        <div data-squelette class="squelette" aria-hidden="true"></div>
      }
    } @else {
      <label class="filtre">
        <span class="sr-only">Filtrer par nom ou email</span>
        <input data-filtre type="search" autocomplete="off" placeholder="Filtrer par nom ou email" [value]="filtre()" (input)="saisirFiltre($event)" />
      </label>
      @if (groupes().length === 0) {
        <p data-aucun class="vide">{{ messageVide() }}</p>
      } @else {
        <div class="cadre">
          <table class="w-full border-collapse text-[12px]">
            <thead>
              <tr class="border-b-fin border-default">
                <th mgTh alignement="gauche">Nom</th>
                <th mgTh alignement="gauche">Email</th>
                <th mgTh alignement="gauche">Rôle</th>
                <th mgTh alignement="gauche">Espaces</th>
                <th mgTh alignement="gauche">Créé le</th>
              </tr>
            </thead>
            @for (g of groupes(); track g.cle) {
              <tbody>
                <tr>
                  <td colspan="5" class="groupe" [attr.data-groupe]="g.cle">
                    <span class="groupe-contenu">
                      <span class="point" aria-hidden="true"></span>
                      <span data-libelle>{{ g.libelle }}</span>
                      <span data-effectif class="effectif">{{ g.effectif }}</span>
                    </span>
                  </td>
                </tr>
                @for (l of g.lignes; track l.id) {
                  <tr class="ligne border-b-fin border-subtle" [attr.data-compte]="l.id" (click)="ouvrirFiche(l.id)">
                    <td mgTd alignement="gauche" class="!font-sans !text-[13px] !text-primary">
                      <button type="button" data-ouvrir class="ouvrir" [attr.aria-label]="l.aria">{{ l.nom }}</button>
                    </td>
                    <td mgTd alignement="gauche" class="email !text-[12px]">{{ l.email }}</td>
                    <td mgTd alignement="gauche" class="!font-sans"><span class="badge">{{ l.role }}</span></td>
                    <td mgTd alignement="gauche" class="!font-sans">
                      @for (e of l.espaces; track e.id) {
                        <span class="pastille" [class.actif]="e.actif" [attr.title]="e.actif ? 'Espace actif' : null">{{ e.nom }}</span>
                      } @empty {
                        <span class="attenue">—</span>
                      }
                    </td>
                    <td mgTd alignement="gauche" attenue>{{ l.creeLe }}</td>
                  </tr>
                }
              </tbody>
            }
          </table>
        </div>
      }
    }

    @if (fiche(); as m) {
      <mg-fiche-utilisateur [membre]="m" (fermer)="fermerFiche($event)" />
    }
    @if (creationOuverte()) {
      <mg-dialogue-creation-compte (cree)="apresEcriture()" (fermer)="creationOuverte.set(false)" />
    }
  `,
  styles: `
    :host { display: block; font-family: var(--font-sans); }
    .entete { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .filtre { display: block; margin-bottom: 12px; }
    .filtre input {
      width: 100%; max-width: 360px;
      background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px;
      padding: 8px 12px; font-family: var(--font-sans); font-size: 13px; color: var(--text-primary); outline: none;
    }
    .filtre input::placeholder { color: var(--text-tertiary); }
    .filtre input:focus { border-color: var(--brand-teal-50); }
    .cadre { border: 0.5px solid var(--border-subtle); border-radius: 8px; background: var(--bg-surface); overflow-x: auto; }
    .groupe { padding: 14px 8px 6px; }
    .groupe-contenu { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; color: var(--text-primary); }
    .point { width: 6px; height: 6px; border-radius: 50%; background: var(--brand-teal); flex-shrink: 0; }
    .effectif { font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); }
    .ligne { cursor: pointer; transition: background-color 150ms var(--ease-hover); }
    .ligne:hover { background: var(--bg-level-2); }
    .ligne:focus-within { background: var(--bg-level-2); }
    .ouvrir {
      all: unset; cursor: pointer; border-radius: 4px;
      font: inherit; color: inherit; text-align: left;
    }
    .ouvrir:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .badge {
      display: inline-block; white-space: nowrap;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-secondary);
      font-size: 10px; border-radius: 4px; padding: 2px 8px;
    }
    .pastille {
      display: inline-block; margin: 2px 4px 2px 0; padding: 2px 8px; border-radius: 4px; white-space: nowrap;
      background: var(--bg-level-3); border: 0.5px solid var(--border-default); color: var(--text-secondary); font-size: 10px;
    }
    .pastille.actif { background: var(--brand-teal-10); border-color: var(--brand-teal-30); color: var(--brand-teal); }
    .attenue { color: var(--text-tertiary); }
    /* Jamais de retour à la ligne : un email se coupe sinon aux traits d'union (capture T1-06). Règle
       du composant, pas l'utilitaire Tailwind, pour ne pas dépendre de la feuille générée. */
    .email { white-space: nowrap; }
    .vide { margin: 0; padding: 12px 14px; font-size: 12px; color: var(--text-tertiary); }
    .bouton {
      flex-shrink: 0; border-radius: 6px; padding: 10px 16px; font-family: var(--font-sans); font-size: 13px; font-weight: 500;
      cursor: pointer; white-space: nowrap;
      transition: background-color 150ms var(--ease-hover), border-color 150ms var(--ease-hover), color 150ms var(--ease-hover);
    }
    .bouton:focus-visible { outline: 2px solid var(--brand-teal-50); outline-offset: 2px; }
    .principal { border: none; background: var(--text-primary); color: var(--bg-primary); }
    /* Survol par l'opacité, comme mg-confirmation : --cta-hover est invariant et serait illisible en thème clair. */
    .principal:hover { opacity: 0.85; }
    .neutre { padding: 7px 14px; font-size: 12px; background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); }
    .neutre:hover { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
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
export class VueComptesComponent {
  private readonly api = inject(EspacesApi);
  private readonly etat = inject(EspacesEtatService);
  private readonly notifications = inject(NotificationsService);
  private lecture: Subscription | null = null;

  /** `null` tant que la première lecture n'a pas répondu. */
  protected readonly comptes = signal<readonly CompteResume[] | null>(null);
  protected readonly erreur = signal<string | null>(null);
  protected readonly filtre = signal('');
  protected readonly fiche = signal<MembreEspace | null>(null);
  protected readonly creationOuverte = signal(false);

  private readonly nomsEspaces = computed(() => new Map(this.etat.espaces().map((e) => [e.id, e.nom_affiche])));

  protected readonly groupes = computed<GroupeAffiche[]>(() =>
    grouperComptes(filtrerComptes(this.comptes() ?? [], this.filtre()), this.nomsEspaces()).map((g) => ({
      cle: g.cle,
      libelle: g.libelle,
      effectif: formaterNombre(g.comptes.length),
      lignes: g.comptes.map((c): LigneCompte => ({
        id: c.id,
        nom: c.nom || TIRET,
        email: c.email,
        role: ROLE_LABELS[c.role] ?? c.role,
        espaces: c.espaces.map((e) => ({ id: e.id, nom: e.nom_affiche, actif: e.id === c.espace_actif })),
        creeLe: dateFr(c.cree_le),
        // Le libellé accessible CONTIENT le texte visible (WCAG 2.5.3) : le nom, ou l'email s'il n'y en a pas.
        aria: c.nom ? `${c.nom}, ouvrir la fiche (${c.email})` : `Ouvrir la fiche de ${c.email}`,
      })),
    })),
  );

  protected readonly messageVide = computed(() => {
    const f = this.filtre().trim();
    return f ? `Aucun compte ne correspond à « ${f} ».` : 'Aucun compte.';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.lecture?.unsubscribe());
    this.lire();
  }

  /** `GET admin/espaces/comptes`. Une relecture qui échoue garde le tableau et le notifie. */
  protected lire(): void {
    this.lecture?.unsubscribe();
    this.erreur.set(null);
    this.lecture = this.api.lireComptes().subscribe({
      next: (r) => this.comptes.set(r.comptes ?? []),
      error: (e: unknown) => {
        if (this.comptes() === null) this.erreur.set(messageErreur(e));
        else this.notifications.error(messageErreur(e));
      },
    });
  }

  protected saisirFiltre(e: Event): void {
    this.filtre.set((e.target as HTMLInputElement).value);
  }

  /** La fiche, sans espace courant : `autres_espaces` porte TOUS les espaces du compte. */
  protected ouvrirFiche(id: string): void {
    const c = this.comptes()?.find((x) => x.id === id);
    if (!c) return;
    this.fiche.set({ id: c.id, email: c.email, nom: c.nom, role: c.role, espace_actif: c.espace_actif, autres_espaces: c.espaces });
  }

  protected fermerFiche(ecrit: boolean): void {
    this.fiche.set(null);
    if (ecrit) this.apresEcriture();
  }

  /** Après une écriture réussie : relecture des comptes ET des compteurs de la colonne. */
  protected apresEcriture(): void {
    this.lire();
    this.etat.recharger();
  }
}

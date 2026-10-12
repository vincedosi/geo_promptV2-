import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { IconeComponent } from '../../../ui/icone/icone.component';
import { PONT_CARTE } from '../../carte/etat/pont-carte';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { codeProfil } from '../logique/code-profil';
import { NIVEAUX, type ProfilRayons, anneauxDuNiveau } from '../logique/profil';

/** Les trois messages de `BoutonVoirCarte.tsx:52-73`, mot pour mot. */
export const MESSAGE_PREPARATION_IMPOSSIBLE = 'Préparation des zones impossible.';
export const MESSAGE_AUCUNE_ZONE = 'Ce profil ne délimite aucune zone : aucun anneau n’est réglé.';
export const MESSAGE_SANS_REPONSE = 'La préparation des zones n’a pas répondu.';

/** Le message d'une préparation refusée : le champ `error` de la route, sinon le message générique (React l.52-56). */
export function messagePreparation(e: unknown): string {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return MESSAGE_SANS_REPONSE;
  const corps: unknown = e.error;
  const message = corps && typeof corps === 'object' ? (corps as { error?: unknown }).error : null;
  return typeof message === 'string' && message ? message : MESSAGE_PREPARATION_IMPOSSIBLE;
}

/**
 * « Voir sur la carte » — portage de `components/risques/BoutonVoirCarte.tsx` (lot 4, T13 ; A6 du lot 3 levé).
 *
 * ── DEUX GESTES EN UN, ET C'EST VOULU ────────────────────────────────────
 * Il PRÉPARE la géométrie du profil (`POST /api/risques/zones/preparer`), PUIS l'allume par le pont de la carte
 * (`PONT_CARTE`), puis émet `affiche` — l'écran se ferme et découvre la carte. Allumer avant de préparer ferait
 * demander des tuiles sous une clé que personne n'a construite : MapLibre échouerait en SILENCE sur une source vide.
 *
 * ── LES NATURES VOYAGENT (défaut React corrigé, B3) ──────────────────────
 * React ne préparait et n'affichait que le profil seul : la carte montrait les zones de TOUTES les natures sous un
 * module filtré sur une seule. Ici `natures` part dans la préparation ET dans l'adresse des tuiles — la même clé que
 * la carte du module. Sans nature retenue (le défaut), la requête est celle de React à l'octet près.
 *
 * Le libellé passe à la ligne comme React (pas de `nowrap` sur le bouton) : l'interdire faisait grandir l'en-tête du
 * module, rétrécir la carte de l'étape et changer son cadrage (revue T21). Il ne se coupe qu'entre « Voir sur » et
 * « la carte » : React tient ces deux lignes parce que son icône lucide RÉTRÉCIT (6,6 px mesurés au lieu de 13) ; icône
 * tenue à 13 px (`shrink-0`), le libellé libre tombait sur trois lignes et l'en-tête passait de 80 à 97 px. Les deux
 * morceaux insécables donnent au bouton une largeur minimale de deux lignes, sans largeur en dur.
 *
 * Rendu seulement quand le pont existe (module monté sous la carte principale) : `RisquePage` le teste. Un profil sans
 * anneau désactive le bouton AVANT toute requête — un aller-retour qui rend « zéro classe » se lirait comme une panne.
 */
@Component({
  selector: 'mg-bouton-voir-carte',
  imports: [IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2' },
  template: `
    <button type="button" data-voir-carte (click)="voir()" [disabled]="enCours() || vide()" [attr.aria-busy]="enCours()"
            [attr.title]="vide() ? 'Réglez au moins un anneau pour délimiter une zone.' : 'Afficher les zones de ce profil sur la carte'"
            class="inline-flex items-center gap-[6px] rounded-[6px] border-fin bg-transparent px-3 py-[6px] text-[12px] font-medium"
            [class.border-teal]="!vide()" [class.text-teal]="!vide()"
            [class.border-default]="vide()" [class.text-tertiary]="vide()"
            [class.cursor-pointer]="!enCours() && !vide()" [class.cursor-not-allowed]="enCours() || vide()">
      @if (enCours()) {
        <mg-icone nom="chargement" [taille]="13" class="shrink-0 animate-spin" />
      } @else {
        <mg-icone nom="carte" [taille]="13" class="shrink-0" />
      }
      <span><span class="whitespace-nowrap">Voir sur</span>&ngsp;<span class="whitespace-nowrap">la carte</span></span>
    </button>
    @if (message(); as m) {
      <span role="alert" class="text-[11px] text-danger">{{ m }}</span>
    }
  `,
})
export class BoutonVoirCarteComponent {
  /** Le profil CALCULÉ du module : la carte dessine ce que le module compte. */
  readonly profil = input.required<ProfilRayons>();
  /** Natures retenues dans le module, vide = toutes. */
  readonly natures = input<readonly string[]>([]);
  /** Les zones sont allumées : l'écran peut se fermer. */
  readonly affiche = output<void>();

  private readonly api = inject(ZonesRisqueApi);
  private readonly pont = inject(PONT_CARTE);

  protected readonly vide = computed(() => NIVEAUX.every((n) => anneauxDuNiveau(this.profil(), n).length === 0));
  protected readonly enCours = signal(false);
  protected readonly message = signal<string | null>(null);
  private abonnement: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  protected voir(): void {
    if (this.enCours() || this.vide()) return;
    // Lus AU CLIC : un réglage fait pendant la préparation ne change pas ce qu'on allume.
    const profil = this.profil();
    const natures = [...this.natures()];
    this.enCours.set(true);
    this.message.set(null);
    this.abonnement?.unsubscribe();
    this.abonnement = this.api.preparer(codeProfil(profil), natures).subscribe({
      next: (corps) => {
        this.enCours.set(false);
        if (((corps as { classes?: number } | null)?.classes ?? 0) === 0) {
          this.message.set(MESSAGE_AUCUNE_ZONE);
          return;
        }
        this.pont.afficherZonesRisque({ profil, natures });
        this.affiche.emit();
      },
      error: (e: unknown) => {
        this.enCours.set(false);
        this.message.set(messagePreparation(e));
      },
    });
  }
}

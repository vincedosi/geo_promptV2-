import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { ZonesApi } from '../../data/zones.api';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { messageErreurRequete } from '../../logique/analyses/commun';
import { MESSAGE_REPONSE_PERDUE, estReponsePerdue } from '../../logique/zones/gestes-zone';
import { MESSAGE_SAUVEGARDE_ECHOUEE } from '../../logique/zones/operations-zones';
import { CODES_PAYS, type Recette, libelleRecette } from '../../logique/zones/recette';
import { STYLES_RECETTE } from './styles-recette';

type CodePays = (typeof CODES_PAYS)[number];

/** Les deux zones prêtes, dans l'ordre d'A-3 : la métropole d'abord. */
const PAYS = CODES_PAYS.map((code) => {
  const recette: Recette = { v: 1, type: 'pays', code };
  return { code, recette, nom: libelleRecette(recette, []) };
});

/**
 * ③ « À la main » — la zone NATIONALE (④ finitions, T6, A-3 ; décision de Vincent du 25/10 : « le national passe par
 * une zone France entière créée en ③ »). Deux boutons, aucun formulaire : la recette `{ v: 1, type: 'pays', code }`
 * est FIGÉE, sa forme (l'union des régions) est calculée par le serveur (`zone_pays_geometrie`, sql/296), et ④ la
 * chiffre par la population nationale sans lire un carreau.
 *
 * ⚠ `POST /api/zones` n'est PAS idempotent : les deux boutons sont inactifs dès le premier clic, jusqu'à la réponse.
 * Un 207 est une réussite (la zone existe). Une réponse perdue (statut 0, 502, 504) renvoie à « Mes zones », jamais à
 * un second envoi à l'aveugle. Aucune lecture à l'ouverture de ③.
 */
@Component({
  selector: 'mg-creer-pays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2" data-creer-pays-bloc>
      <p class="titre-recette">Zone nationale</p>
      <p class="garde">Pour une campagne nationale : la zone se chiffre à l’étape ④ par la population nationale.</p>
      <div class="flex gap-1.5">
        @for (p of pays; track p.code) {
          <button type="button" class="neutre flex-1" [attr.data-creer-pays]="p.code" [disabled]="enVol() !== null || !org()" (click)="creer(p.code)">
            {{ enVol() === p.code ? 'Création…' : p.nom }}
          </button>
        }
      </div>
      @if (message(); as m) {
        <div data-message-pays role="status" [class]="reussite() ? 'succes' : 'erreur'">{{ m }}</div>
      }
    </div>
  `,
  styles: STYLES_RECETTE,
})
export class CreerPaysComponent {
  private readonly api = inject(ZonesApi);
  /** L'organisation active (le panneau ③ la lit une fois) : sans elle, les boutons restent inactifs. */
  protected readonly org = inject(CreationZoneService).org;

  /** Une zone vient d'être créée : le panneau relit « Mes zones ». */
  readonly cree = output<void>();

  protected readonly pays = PAYS;
  /** Le code en cours d'écriture, ou `null`. */
  protected readonly enVol = signal<CodePays | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly reussite = signal(false);
  private abonnement: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abonnement?.unsubscribe());
  }

  protected creer(code: CodePays): void {
    const p = PAYS.find((x) => x.code === code);
    if (!p || this.enVol() !== null || !this.org()) return;
    this.enVol.set(code);
    this.message.set(null);
    this.abonnement = this.api.enregistrer({ nom: p.nom, recette: p.recette }).subscribe({
      next: (r) => {
        const b = r.body;
        if (!b?.zone_id) {
          this.finir(MESSAGE_REPONSE_PERDUE, false);
          return;
        }
        this.finir(r.status === 207 ? b.message ?? `Zone créée : ${p.nom}.` : `Zone créée : ${p.nom}. Chiffrez-la à l’étape ④.`, true);
        this.cree.emit();
      },
      error: (e: unknown) => {
        const perdue = e instanceof HttpErrorResponse && estReponsePerdue(e);
        const texte = e instanceof HttpErrorResponse && typeof (e.error as { error?: unknown } | null)?.error === 'string'
          ? messageErreurRequete(e) : MESSAGE_SAUVEGARDE_ECHOUEE;
        this.finir(perdue ? MESSAGE_REPONSE_PERDUE : texte, false);
      },
    });
  }

  private finir(message: string, reussite: boolean): void {
    this.abonnement = null;
    this.enVol.set(null);
    this.reussite.set(reussite);
    this.message.set(message);
  }
}

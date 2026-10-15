import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import type { Subscription } from 'rxjs';
import { formaterNombre } from '../../../../core/format/nombre';
import { ZonesCustomApi } from '../../data/zones-custom.api';
import { CreationZoneService } from '../../etat/creation-zone.service';
import { MAX_CP, apercuCodesPostaux, messageZoneCodesPostaux, nomCodesPostauxFichier } from '../../logique/zones/creation-zone';
import { parserCodesPostaux } from '../../logique/zones/parse-cp';
import { OutilCreationComponent } from './outil-creation.component';

/**
 * « Importer une liste de codes postaux » — `app/map/_components/panneaux/CreerZoneCodesPostaux.tsx` (lot 4, T16).
 *
 * Deux gestes pour la même chose : coller une liste, ou déposer un fichier. L'aperçu se calcule À LA FRAPPE par le
 * même parseur que la route, sans requête : on corrige avant de créer, pas après. La route distingue ensuite les
 * codes bien formés mais absents du référentiel, que le client ne peut pas connaître — dits séparément des rejets.
 *
 * Écart voulu sur le fichier : React lisait le fichier dans le navigateur et envoyait son TEXTE en JSON. Ici le
 * fichier est lu pour l'aperçu, puis envoyé TEL QUEL en multipart (la route l'accepte, et y applique son plafond de
 * 2 Mo) — sauf si la saisie a été retouchée depuis le dépôt : c'est alors le texte affiché qui part, celui que
 * l'utilisateur a sous les yeux.
 */
@Component({
  selector: 'mg-creer-codes-postaux',
  imports: [OutilCreationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mg-outil-creation
      titre="Importer une liste de codes postaux"
      [ouvert]="ouvert()"
      [(nom)]="nom"
      [enCours]="enCours()"
      [inactif]="inactif()"
      [erreur]="erreur()"
      [message]="message()"
      (basculer)="ouvert.set($event)"
      (creer)="creer()"
    >
      <textarea
        rows="4"
        placeholder="Collez vos codes postaux&#10;75001, 75002 ; 69001…"
        class="champ w-full resize-y rounded-[6px] border-fin border-subtle bg-elevated px-[10px] py-2 font-mono text-[11px] text-primary outline-none"
        [value]="saisie()"
        (input)="saisie.set($any($event.target).value)"
      ></textarea>

      <div class="flex gap-1.5">
        <input #fichier type="file" accept=".txt,.csv,text/plain,text/csv" class="hidden" (change)="deposer($event)" />
        <button
          type="button"
          data-deposer
          class="flex-1 cursor-pointer rounded-[6px] border-fin border-default bg-transparent px-[10px] py-1.5 text-[11px] text-secondary"
          (click)="fichier.click()"
        >Déposer un fichier</button>
      </div>

      @if (apercu(); as a) {
        <div data-apercu class="font-mono text-[10px] leading-[1.6] text-tertiary">
          <span data-reconnus [class]="a.trop ? 'text-danger' : 'text-teal'">{{ a.reconnus }}</span>
          @if (a.rejetes) {
            <span data-rejetes class="text-warning"> · {{ a.rejetes }}</span>
            <div data-liste-rejetes>{{ a.listeRejetes }}</div>
          }
          @if (a.trop) {
            <div class="text-danger">Maximum {{ maximum }} par import.</div>
          }
        </div>
      }
    </mg-outil-creation>
  `,
  styles: `.champ:focus { border-color: var(--brand-teal-50); }`,
})
export class CreerCodesPostauxComponent {
  private readonly api = inject(ZonesCustomApi);
  private readonly creation = inject(CreationZoneService);

  /** Une zone vient d'être créée : le panneau relit « Mes zones ». */
  readonly cree = output<void>();

  protected readonly ouvert = signal(false);
  protected readonly saisie = signal('');
  protected readonly nom = signal('');
  protected readonly enCours = signal(false);
  protected readonly erreur = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly maximum = formaterNombre(MAX_CP);
  /** Le fichier déposé et le texte qu'il a donné : il ne part que si la saisie n'a pas été retouchée. */
  private depot: { fichier: File; texte: string } | null = null;

  protected readonly apercu = computed(() => apercuCodesPostaux(this.saisie()));
  protected readonly inactif = computed(() => {
    const a = this.apercu();
    return this.enCours() || !a?.nCodes || a.trop || !this.creation.org();
  });
  private readonly champFichier = viewChild.required<ElementRef<HTMLInputElement>>('fichier');

  private abonnement: Subscription | null = null;
  private detruit = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.detruit = true;
      this.abonnement?.unsubscribe();
    });
  }

  protected async deposer(e: Event): Promise<void> {
    const fichier = (e.target as HTMLInputElement).files?.[0];
    if (!fichier) return;
    this.erreur.set(null);
    try {
      const texte = await fichier.text();
      if (this.detruit) return;
      this.depot = { fichier, texte };
      this.saisie.set(texte);
      if (!this.nom()) this.nom.set(nomCodesPostauxFichier(fichier.name));
    } catch {
      this.erreur.set('Fichier illisible.');
    }
  }

  protected creer(): void {
    const geste = this.apercu();
    if (this.inactif() || !geste) return;
    const saisie = this.saisie();
    const envoi = this.depot && this.depot.texte === saisie ? this.depot.fichier : saisie;
    const nom = this.nom();
    this.enCours.set(true);
    this.erreur.set(null);
    this.message.set(null);
    this.abonnement = this.creation.creer(
      this.api.depuisCodesPostaux(envoi),
      (geo) => nom || `Liste de ${geo.n_codes} codes postaux`,
      // Les codes RETENUS par la route (connus du référentiel) ; à défaut, les codes bien formés de la saisie.
      (geo) => ({ v: 1, type: 'codes_postaux', codes: geo.codes?.length ? geo.codes : parserCodesPostaux(saisie).codes }),
    ).subscribe((issue) => {
      this.enCours.set(false);
      if ('erreur' in issue) {
        this.erreur.set(issue.erreur);
        return;
      }
      this.message.set(messageZoneCodesPostaux(issue.geo, issue.countCp));
      this.saisie.set('');
      this.nom.set('');
      this.depot = null;
      this.champFichier().nativeElement.value = '';
      this.cree.emit();
    });
  }
}

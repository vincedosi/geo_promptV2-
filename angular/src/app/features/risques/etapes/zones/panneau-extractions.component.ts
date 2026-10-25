import { HttpErrorResponse, type HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { type Observable, firstValueFrom } from 'rxjs';
import { dateHeureFr } from '../../../../core/format/date';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { type Extraction, JeuxZonesApi } from '../../data/jeux-zones.api';
import { BoutonExportComponent } from '../../exports/bouton-export.component';

/** Les textes du panneau, MOT POUR MOT de `PanneauExtractions.tsx`. */
export const TEXTES_EXTRACTIONS = {
  brouillon: 'Enregistrez d’abord ce jeu de zones : une extraction porte son nom et son numéro de version.',
  aide: 'Extraire fige les multiplicateurs tels qu’ils sont, sous un numéro de version. À la différence de '
    + '« Exporter (Excel) », qui recalcule à chaque clic et suit donc vos réglages, une extraction ne bouge plus — '
    + 'c’est elle qui dira, plus tard, ce qui est réellement parti au DSP.',
  placeholder: 'Pourquoi cette extraction (facultatif)',
  bouton: 'Extraire pour le custom bidding',
  recalage: 'C’est un recalage — cette version corrige une diffusion déjà mesurée.',
  lecture: 'Lecture des extractions…',
  aucune: 'Aucune extraction pour l’instant. La première fixera la référence à laquelle la diffusion sera comparée.',
  illisibles: 'Extractions illisibles.',
  illisiblesSansReponse: 'Extractions illisibles — le serveur n’a pas répondu.',
  impossible: 'Extraction impossible.',
  impossibleSansReponse: 'Extraction impossible — le serveur n’a pas répondu.',
} as const;

/** La réponse de POST …/extractions (`app/api/zones/jeux/[id]/extractions/route.ts`). */
interface ReponseExtraction {
  version?: number;
  deja_extraite?: boolean;
}

type EtatListe = 'chargement' | 'echec' | 'pret';


/**
 * Le message d'une réponse en erreur : le champ `error` du corps JSON, le message par défaut sinon ; une requête
 * qui n'a pas abouti du tout (statut 0) prend le message « le serveur n'a pas répondu », comme le `catch` de React.
 */
function messageErreur(e: unknown, defaut: string, sansReponse: string): string {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return sansReponse;
  const corps = e.error as { error?: unknown } | null;
  return corps && typeof corps === 'object' && typeof corps.error === 'string' ? corps.error : defaut;
}

interface LigneExtraction {
  id: string;
  version: number;
  recalage: boolean;
  commentaire: string;
  date: string;
  seuil: string;
  retenus: string;
  touches: string;
  taux: string;
}

const AIDE = 'm-0 text-[12px] leading-[1.5] text-tertiary';
const TH = 'px-2 py-[6px] text-[11px] font-normal text-tertiary';
const TD = 'px-2 py-[7px] font-mono text-[12px] text-secondary';

/**
 * Les extractions d'un jeu de zones — portage de `PanneauExtractions.tsx` (Phase 4 du chantier zones → CP).
 *
 * ── EXTRAIRE N'EST PAS EXPORTER ──────────────────────────────────────────
 *
 * « Exporter (Excel) » recalcule le plan à chaque clic : il suit le jeu. Extraire FIGE les multiplicateurs sous un
 * numéro de version, pour dire plus tard ce qui est réellement parti au DSP. Le panneau le dit en toutes lettres.
 *
 * - Un BROUILLON n'extrait pas (`jeuId` null) : le message de React, et AUCUN appel.
 * - IDEMPOTENT à contenu identique : la route rend la version existante avec `deja_extraite` — c'est dit, ce n'est
 *   ni une erreur ni une création. Le commentaire n'entre pas dans l'empreinte (côté serveur).
 * - Le recalage est une CASE et non un autre bouton, proposée seulement quand une extraction existe déjà : recaler ce
 *   qui n'a jamais été diffusé n'a pas de sens.
 * - La liste se relit à chaque changement de `cleFraicheur` (`construit_le` du jeu) : les versions figées restent
 *   valables, mais le plan courant a changé.
 * - Le classeur d'une version passe par `mg-bouton-export` (A8) : React posait un `<a href>` vers une route qui ne
 *   lit que l'en-tête `Authorization`, donc partait sans jeton (401).
 */
@Component({
  selector: 'mg-panneau-extractions',
  imports: [BoutonExportComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (jeuId() === null) {
      <p data-role="brouillon" [class]="aide">{{ textes.brouillon }}</p>
    } @else {
      <div class="flex flex-col gap-3">
        <p [class]="aide">{{ textes.aide }}</p>

        <div class="flex flex-wrap items-center gap-[10px]">
          <input [value]="commentaire()" (input)="commentaire.set(texte($event))" [placeholder]="textes.placeholder"
                 aria-label="Commentaire de l’extraction" maxlength="500"
                 class="flex-[1_1_260px] rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-[13px] text-primary" />
          <button type="button" data-role="extraire" (click)="extraire()" [disabled]="enCours()"
                  class="inline-flex items-center gap-[7px] rounded-[6px] border-fin border-teal bg-transparent px-4 py-2 text-[12px] font-medium text-teal"
                  [class.opacity-50]="enCours()" [class.cursor-not-allowed]="enCours()" [class.cursor-pointer]="!enCours()">
            @if (enCours()) {
              <mg-icone nom="chargement" [taille]="13" class="animate-spin" />
            } @else {
              <mg-icone nom="colis-coche" [taille]="13" />
            }
            {{ textes.bouton }}
          </button>
        </div>

        @if (extractions().length > 0) {
          <label data-role="recalage" [class]="aide + ' flex cursor-pointer items-center gap-2'">
            <input type="checkbox" [checked]="recalage()" (change)="recalage.set(coche($event))" class="accent-teal" />
            <span>{{ textes.recalage }}</span>
          </label>
        }

        @if (message(); as m) {
          <p role="status" data-role="message"
             class="m-0 rounded-[6px] border-fin border-teal/30 bg-teal-10 px-3 py-2 text-[12px] leading-[1.5] text-teal">{{ m }}</p>
        }
        @if (erreur(); as e) {
          <p role="status" data-role="erreur"
             class="m-0 rounded-[6px] border-fin border-danger/20 bg-danger/10 px-3 py-2 text-[12px] leading-[1.5] text-danger">{{ e }}</p>
        }

        @switch (etat()) {
          @case ('chargement') {
            <p data-role="lecture" [class]="aide">
              <mg-icone nom="chargement" [taille]="13" class="mr-[6px] inline-block animate-spin align-[-2px]" />{{ textes.lecture }}
            </p>
          }
          @case ('pret') {
            @if (lignes().length === 0) {
              <p data-role="aucune" [class]="aide">{{ textes.aucune }}</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr class="border-b border-subtle">
                      <th scope="col" [class]="th + ' text-left'">Version</th>
                      <th scope="col" [class]="th + ' text-left'">Extraite le</th>
                      <th scope="col" [class]="th + ' text-right'">Seuil</th>
                      <th scope="col" [class]="th + ' text-right'">CP retenus</th>
                      <th scope="col" [class]="th + ' text-right'">Taux d’utile</th>
                      <th scope="col" [class]="th + ' text-left'">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of lignes(); track l.id) {
                      <tr data-role="extraction" class="border-b border-subtle">
                        <td [class]="td + ' text-left'">
                          <span class="text-primary">v{{ l.version }}</span>
                          @if (l.recalage) {
                            <span data-role="etiquette-recalage"
                                  class="ml-[6px] rounded-[4px] border-fin border-default bg-overlay px-2 py-[2px] font-sans text-[10px] text-tertiary">
                              <mg-icone nom="rafraichir" [taille]="10" class="mr-[3px] inline-block align-[-1px]" />recalage
                            </span>
                          }
                          @if (l.commentaire) {
                            <span data-role="commentaire" [title]="l.commentaire"
                                  class="mt-[2px] block max-w-[260px] overflow-hidden font-sans text-[11px] text-ellipsis whitespace-nowrap text-tertiary">{{ l.commentaire }}</span>
                          }
                        </td>
                        <td [class]="td + ' text-left font-sans'">{{ l.date }}</td>
                        <td [class]="td + ' text-right'">{{ l.seuil }}</td>
                        <td [class]="td + ' text-right'">{{ l.retenus }}<span class="text-tertiary"> / {{ l.touches }}</span></td>
                        <!-- « — » et non « 0 % » : aucun code postal retenu n'est pas un taux nul, c'est l'absence de ratio. -->
                        <td [class]="td + ' text-right'">{{ l.taux }}</td>
                        <td [class]="td + ' text-left'">
                          <mg-bouton-export libelle="Excel" variante="lien" [charger]="chargeur(l.version)"
                                            [nomRepli]="'extraction-v' + l.version + '.xlsx'" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        }
      </div>
    }
  `,
})
export class PanneauExtractionsComponent {
  /** `null` tant que le jeu est un brouillon : on n'extrait pas un sans-nom. */
  readonly jeuId = input.required<string | null>();
  /** Change à chaque reconstruction du jeu (`construit_le`) : la liste se relit. */
  readonly cleFraicheur = input<string>('');

  private readonly api = inject(JeuxZonesApi);

  protected readonly textes = TEXTES_EXTRACTIONS;
  protected readonly aide = AIDE;
  protected readonly th = TH;
  protected readonly td = TD;

  protected readonly extractions = signal<Extraction[]>([]);
  protected readonly etat = signal<EtatListe>('chargement');
  protected readonly erreur = signal<string | null>(null);
  protected readonly commentaire = signal('');
  protected readonly recalage = signal(false);
  protected readonly enCours = signal(false);
  protected readonly message = signal<string | null>(null);

  /** Le jeton de la DERNIÈRE lecture : une réponse dépassée (autre jeu, autre fraîcheur) est jetée. */
  private jeton = 0;
  private detruit = false;
  /** Un chargeur de classeur par version, gardé : `[charger]` reçoit la même référence d'un rendu à l'autre. */
  private readonly chargeurs = new Map<string, () => Observable<HttpResponse<Blob>>>();

  protected readonly lignes = computed<LigneExtraction[]>(() => this.extractions().map((e) => ({
    id: e.id,
    version: e.version,
    recalage: e.origine === 'recalage',
    commentaire: e.commentaire,
    date: dateHeureFr(e.created_at),
    seuil: `${formaterDecimal(Number(e.seuil_couverture_cp), 0)} %`,
    retenus: formaterNombre(e.n_retenus),
    touches: formaterNombre(e.n_cp),
    taux: e.taux_utile == null ? '—' : `${formaterDecimal(Number(e.taux_utile), 1)} %`,
  })));

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.detruit = true; });
    effect(() => {
      const id = this.jeuId();
      this.cleFraicheur();
      untracked(() => void this.charger(id));
    });
  }

  protected chargeur(version: number): () => Observable<HttpResponse<Blob>> {
    const id = this.jeuId() ?? '';
    const cle = `${id}:${version}`;
    let f = this.chargeurs.get(cle);
    if (!f) {
      f = () => this.api.exportExtraction(id, version);
      this.chargeurs.set(cle, f);
    }
    return f;
  }

  protected texte(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  protected coche(ev: Event): boolean {
    return (ev.target as HTMLInputElement).checked;
  }

  private async charger(id: string | null): Promise<void> {
    const mien = ++this.jeton;
    if (!id) {
      this.extractions.set([]);
      this.etat.set('pret');
      return;
    }
    this.etat.set('chargement');
    this.erreur.set(null);
    try {
      const rep = await firstValueFrom(this.api.extractions(id));
      if (this.detruit || mien !== this.jeton) return;
      this.extractions.set(rep.extractions ?? []);
      this.etat.set('pret');
    } catch (e) {
      if (this.detruit || mien !== this.jeton) return;
      this.erreur.set(messageErreur(e, TEXTES_EXTRACTIONS.illisibles, TEXTES_EXTRACTIONS.illisiblesSansReponse));
      this.etat.set('echec');
    }
  }

  protected async extraire(): Promise<void> {
    const id = this.jeuId();
    if (!id || this.enCours()) return;
    this.enCours.set(true);
    this.erreur.set(null);
    this.message.set(null);
    try {
      let rep: ReponseExtraction | null;
      try {
        rep = await firstValueFrom(this.api.extraire(id, {
          origine: this.recalage() ? 'recalage' : 'initiale',
          commentaire: this.commentaire().trim(),
        })) as ReponseExtraction | null;
      } catch (e) {
        if (!this.detruit) {
          this.erreur.set(messageErreur(e, TEXTES_EXTRACTIONS.impossible, TEXTES_EXTRACTIONS.impossibleSansReponse));
        }
        return;
      }
      if (this.detruit) return;
      // ⚠ « Déjà extraite » n'est ni une erreur ni une création : sans ce message, cliquer deux fois laisserait
      // croire à deux versions, alors que la route a rendu la même parce que rien n'avait changé.
      this.message.set(rep?.deja_extraite
        ? `Rien n’a changé depuis la v${rep.version} : c’est elle qui reste en vigueur.`
        : `Extraction v${rep?.version} enregistrée — elle ne bougera plus.`);
      this.commentaire.set('');
      this.recalage.set(false);
      await this.charger(id);
    } finally {
      if (!this.detruit) this.enCours.set(false);
    }
  }
}

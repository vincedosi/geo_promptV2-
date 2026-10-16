import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import { CampagneOohService } from '../../couches/campagne-ooh.service';
import { type EmplacementOoh, type LigneOoh, libelleEcart, libelleNonPlaces, libellePeriode, montantTtc } from '../../logique/campagnes-ooh';
import { EnteteFiltreComponent } from '../filtre/perimetre.component';
import { SelectionsCalquesService } from './selections-calques.service';

/**
 * « Panneaux OOH et DOOH » du panneau « Autres » (spec 2026-10-16-ooh-campagnes § 6) : on ne choisit plus des régies
 * d'un inventaire partagé — les 1 434 panneaux de Brest étaient un essai, purgés (sql/260) — mais une CAMPAGNE de
 * l'espace de travail. Trois états :
 *   1. la liste des campagnes OOH de l'espace, lue UNE fois, à la première ouverture de la section (I/O) ;
 *   2. la campagne choisie : ses lignes OOH dans l'ordre du plan — pastille de teinte, régie et réseau, dates, écrans,
 *      budget, contacts, case afficher/masquer, écart entre la liste de la régie et le plan, points à vérifier et
 *      emplacements non placés (dépliables ; un point à vérifier s'ouvre dans sa fiche, pré-vol P6) ; les lignes sans
 *      liste (DROM) regroupées, avec la phrase qui le dit ;
 *   3. le retour à la liste.
 * L'état vit dans `CampagneOohService` (page) : fermer « Autres » ou replier la section ne perd rien ; changer
 * d'espace recrée la page et vide tout. La pastille est en CSS (`var(--ligne-media-n)`), la carte reçoit les mêmes
 * teintes calculées.
 */
@Component({
  selector: 'mg-section-ooh',
  imports: [EnteteFiltreComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    @keyframes fondu { from { opacity: 0; } to { opacity: 1; } }
    .fondu { animation: fondu 200ms var(--ease-out); }
  `,
  host: { class: 'flex flex-col gap-[10px]' },
  template: `
    <mg-entete-filtre libelle="Panneaux OOH et DOOH" [ouvert]="ouvert()" [compte]="service.detail() ? 1 : 0"
      (basculer)="selections.basculerSection('ooh')" />
    @if (ouvert()) {
      <div class="fondu flex flex-col gap-2" data-contenu-ooh>
        @if (service.detail(); as d) {
          <button type="button" data-retour-liste (click)="service.fermer()"
            class="cursor-pointer self-start border-0 bg-transparent p-0 text-[11px] text-tertiary hover:text-secondary">← Toutes les campagnes</button>
          <div data-campagne class="flex flex-col gap-0.5">
            <div class="text-[13px] font-medium text-primary">{{ d.campagne.nom }}</div>
            <div class="text-[11px] text-tertiary">
              @if (d.campagne.vague) { <span>{{ d.campagne.vague }} · </span> }{{ periode(d.campagne.date_debut, d.campagne.date_fin) }}
            </div>
          </div>
          @if (d.tronque) {
            <div data-tronque class="text-[11px] text-warning">Campagne tronquée : seuls les {{ nombre(d.emplacements.length) }} premiers emplacements sont sur la carte.</div>
          }
          @for (l of lignesAvecListe(); track l.id) {
            <div [attr.data-ligne]="l.id" class="flex flex-col gap-1 rounded-[6px] border-fin border-subtle bg-elevated p-2.5">
              <label class="flex cursor-pointer items-center gap-2 text-[12px] text-primary">
                <input type="checkbox" data-afficher-ligne [checked]="!masquee(l)" (change)="service.basculerLigne(l.id)"
                  class="cursor-pointer accent-[var(--brand-teal)]" />
                <span data-pastille class="size-2.5 shrink-0 rounded-full" [attr.data-rang]="rang(l)" [style.background-color]="couleur(l)"></span>
                <span>{{ l.regie }}@if (l.reseau) { · {{ l.reseau }} }</span>
              </label>
              <div class="flex flex-col pl-6 text-[11px] leading-[1.5] text-secondary">
                <div>{{ periode(l.date_debut, l.date_fin) }}@if (l.duree_libelle) { ({{ l.duree_libelle }}) }</div>
                <div class="font-mono">{{ nombre(l.nb_ecrans) }} écrans · {{ montant(l.total_ttc) }}</div>
                @if (l.contacts_15_plus !== null || l.contacts_18_24 !== null) {
                  <div class="font-mono">Contacts 15+ : {{ nombre(l.contacts_15_plus) }} · 18-24 : {{ nombre(l.contacts_18_24) }}</div>
                }
                @if (ecart(l); as e) { <div data-ecart class="text-tertiary">{{ e }}</div> }
                @if (l.nb_a_verifier > 0) {
                  <details data-a-verifier class="mt-1">
                    <summary class="cursor-pointer text-tertiary">{{ nombre(l.nb_a_verifier) }} à vérifier (cerne pointillé)</summary>
                    <ul class="m-0 mt-1 list-none p-0">
                      @for (e of aVerifier().get(l.id) ?? []; track e.properties.id) {
                        <li class="text-tertiary">
                          <button type="button" [attr.data-ouvrir-emplacement]="e.properties.id" (click)="service.selectionner(e.properties.id)"
                            class="cursor-pointer border-0 bg-transparent p-0 text-left text-[11px] text-secondary underline decoration-dotted underline-offset-2 hover:text-primary">{{ e.properties.nom_lieu || 'Emplacement sans nom' }}</button>@if (e.properties.geoloc_libelle) { — {{ e.properties.geoloc_libelle }} }
                        </li>
                      }
                    </ul>
                  </details>
                }
                @if (l.nb_non_places > 0) {
                  <details data-non-places class="mt-1">
                    <summary class="cursor-pointer text-warning">{{ nonPlaces(l.nb_non_places) }}</summary>
                    <ul class="m-0 mt-1 list-none p-0">
                      @for (n of l.details.non_places ?? []; track $index) {
                        <li class="text-tertiary"><span class="text-secondary">{{ n.nom }}</span> — {{ n.raison }}</li>
                      }
                    </ul>
                  </details>
                }
              </div>
            </div>
          }
          @if (lignesSansListe().length > 0) {
            <div data-sans-liste class="flex flex-col gap-1 rounded-[6px] border-fin border-subtle p-2.5">
              <div class="text-[12px] text-primary">{{ lignesSansListe().length }} ligne{{ lignesSansListe().length > 1 ? 's' : '' }} sans emplacement · <span class="font-mono">{{ nombre(facesSansListe()) }}</span> faces</div>
              <p class="m-0 text-[11px] text-tertiary">Liste des emplacements non fournie par la régie.</p>
              @for (l of lignesSansListe(); track l.id) {
                <div [attr.data-ligne-sans-liste]="l.id" class="text-[11px] text-secondary">
                  {{ l.regie }} · {{ l.territoire ?? l.reseau }} — {{ nombre(l.nb_ecrans) }} faces{{ l.format ? ' ' + l.format : '' }} · {{ periode(l.date_debut, l.date_fin) }} · {{ montant(l.total_ttc) }}
                </div>
              }
            </div>
          }
        } @else {
          @if (service.chargementListe()) { <div data-chargement-liste class="text-[11px] text-tertiary">Lecture des campagnes…</div> }
          @if (service.erreurListe(); as e) { <div data-erreur class="font-mono text-[10px] text-danger">! {{ e }}</div> }
          <!-- Au-dessus de la liste : une liste longue ne doit pas pousser l'échec hors de vue. -->
          @if (service.chargementDetail()) { <div data-chargement-detail class="text-[11px] text-tertiary">Lecture de la campagne…</div> }
          @if (service.erreurDetail(); as e) { <div data-erreur-detail role="alert" class="font-mono text-[10px] text-danger">! {{ e }}</div> }
          @if (service.campagnes(); as cs) {
            @if (cs.length === 0) {
              <div data-aucune-campagne class="text-[12px] text-tertiary">Aucune campagne OOH dans cet espace de travail.</div>
            }
            @for (c of cs; track c.id) {
              <button type="button" [attr.data-choisir-campagne]="c.id" (click)="service.choisir(c.id)" [disabled]="service.chargementDetail()"
                class="flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] border-fin border-subtle bg-elevated px-3 py-2 text-left hover:border-hover disabled:cursor-wait">
                <span class="text-[12px] text-primary">{{ c.nom }}</span>
                <span class="text-[11px] text-tertiary">
                  @if (c.vague) { <span>{{ c.vague }} · </span> }{{ periode(c.date_debut, c.date_fin) }} · {{ c.lignes.length }} ligne{{ c.lignes.length > 1 ? 's' : '' }}
                </span>
              </button>
            }
            @if (service.listeTronquee()) {
              <div class="text-[11px] text-warning">Plus de 200 campagnes : seules les 200 plus récentes sont listées.</div>
            }
          }
        }
      </div>
    }
  `,
})
export class SectionOohComponent {
  protected readonly selections = inject(SelectionsCalquesService);
  protected readonly service = inject(CampagneOohService);
  protected readonly ouvert = computed(() => this.selections.sections()['ooh'] !== false);
  protected readonly lignesAvecListe = computed(() => (this.service.detail()?.lignes ?? []).filter((l) => l.a_des_emplacements));
  protected readonly lignesSansListe = computed(() => (this.service.detail()?.lignes ?? []).filter((l) => !l.a_des_emplacements));
  protected readonly facesSansListe = computed(() => this.lignesSansListe().reduce((s, l) => s + (l.nb_ecrans ?? 0), 0));
  /** Les emplacements `a_verifier` de chaque ligne, dans l'ordre de la campagne (pré-vol P6 : listés, pas seulement comptés). */
  protected readonly aVerifier = computed(() => {
    const parLigne = new Map<string, EmplacementOoh[]>();
    for (const e of this.service.detail()?.emplacements ?? []) {
      if (e.properties.geoloc_qualite !== 'a_verifier') continue;
      const liste = parLigne.get(e.properties.ligne_id);
      if (liste) liste.push(e);
      else parLigne.set(e.properties.ligne_id, [e]);
    }
    return parLigne;
  });
  protected readonly nombre = formaterNombre;
  protected readonly periode = libellePeriode;
  protected readonly ecart = libelleEcart;
  protected readonly nonPlaces = libelleNonPlaces;
  protected readonly montant = montantTtc;

  constructor() {
    // La liste n'est lue qu'à la première ouverture de la section (règles I/O) ; le service ne relit pas ensuite.
    effect(() => {
      if (this.ouvert()) untracked(() => this.service.lireCampagnes());
    });
  }

  protected rang(l: LigneOoh): number {
    return this.service.rangs().get(l.id) ?? 1;
  }

  protected couleur(l: LigneOoh): string {
    return `var(--ligne-media-${this.rang(l)})`;
  }

  protected masquee(l: LigneOoh): boolean {
    return this.service.masquees().has(l.id);
  }
}

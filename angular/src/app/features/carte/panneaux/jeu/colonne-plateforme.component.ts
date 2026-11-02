import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { IconeComponent } from '../../../../ui/icone/icone.component';
import { DilutionComponent } from '../../../risques/etapes/zones/dilution.component';
import { libellesPaliers } from '../../couches/couche-unites';
import { JeuCarteService } from '../../couches/jeu-carte.service';
import { MAX_CODES_CONTOURS } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { estExacte } from '../../logique/jeu/bilan';
import { rayonDefautExplique } from '../../logique/jeu/mailles-url';
import { LIBELLE_POPULATION_INCONNUE, NOTE_PAYS_A_VERIFIER, mailleSansObjet, paysAVerifier } from '../../logique/jeu/conversion';
import {
  M_PAR_KM, MESSAGE_MOTIF_VIDE, NOM_PLATEFORME, UNITE_MAILLE, bornesRayon, dateReleve, libelleCurseurSeuil, nombreUnites, texteAvertissement,
  texteChevauchement, texteDefaut, texteDiffusionInconnue, texteRayonDefaut, texteUnitePays,
} from '../../logique/jeu/ecran';
import type { Maille, Plateforme } from '../../logique/jeu/plateformes';
import { ENCART_AVERTISSEMENT_LISIBLE, ENCART_ERREUR, PASTILLE, PASTILLE_INACTIVE, PASTILLE_PRIMAIRE_ACTIVE } from '../analyse/styles-analyse';
import { PALIERS_CSS } from '../analyse/tableau-couverture-zone.component';
import { ChoixMailleComponent } from './choix-maille.component';

/**
 * ⑤ Jeu de zones — la colonne d'UNE plateforme (lot 5, T10) : sa maille, son seuil (et son rayon pour le cercle), et
 * ce que ce choix PERD, chiffré. Lit `JeuZonesService` (fourni par la page) ; c'est le panneau qui décide quelles
 * colonnes demandent leur conversion (les colonnes ouvertes), jamais la colonne elle-même.
 *
 * ── AUCUNE REQUÊTE PAR PIXEL (P-h) ───────────────────────────────────────
 * Le seuil passe par `mg-dilution` du module risque, qui n'émet qu'au RELÂCHEMENT : `regler` rejoue le seuil en
 * mémoire pour une maille territoriale (aucune requête) ; pour le cercle, le pavage est calculé au serveur à ce
 * seuil, et la requête part au relâchement (le panneau rappelle `valider`). La réglette de rayon suit le doigt
 * localement et ne règle qu'au relâchement — bornée par la ligne de `plateformes_geo` (`regler` ne borne pas).
 *
 * Les chiffres sont en JetBrains Mono : unités retenues / touchées, taux d'utile, habitants manqués (et leur part de
 * la zone), diffusion hors zone ; une maille exacte (A-6) dit « exacte : aucune perte » sans calcul.
 *
 * « Voir sur la carte » (T11) : la plateforme REGARDÉE, peinte par `JeuCarteService` (une à la fois).
 */
@Component({
  selector: 'mg-colonne-plateforme',
  imports: [ChoixMailleComponent, DilutionComponent, IconeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-col rounded-[8px] border-fin border-subtle bg-surface', '[attr.data-plateforme]': 'plateforme()' },
  template: `
    <button type="button" data-entete-colonne (click)="basculer.emit()" [attr.aria-expanded]="ouverte()" [disabled]="!repliable()"
      class="flex w-full items-center gap-2 bg-transparent px-3 py-2.5 text-left enabled:cursor-pointer">
      <span class="flex-1 text-[12px] font-medium text-primary">{{ nom() }}</span>
      @if (!ouverte() && bilan()) { <span class="font-mono text-[11px] text-secondary">{{ tauxTexte() }}</span> }
      @if (repliable()) { <mg-icone [nom]="ouverte() ? 'chevron-haut' : 'chevron-bas'" [taille]="14" [trait]="1.5" class="shrink-0 text-tertiary" /> }
    </button>
    @if (ouverte()) {
      <div class="flex flex-col gap-3 border-t-fin border-subtle px-3 py-3" data-corps-colonne>
        @if (lignes().length === 0) {
          <div class="font-mono text-[11px] text-tertiary">Lecture des règles de la plateforme…</div>
        } @else {
          <mg-choix-maille [lignes]="lignesChoix()" [maille]="choix()?.maille ?? null" (choisie)="regler({ maille: $event })" />
          @if (ligne(); as l) {
            <div class="flex flex-wrap items-center gap-2 text-[10px] text-tertiary">
              @if (aVerifier(); as v) {
                <span data-a-verifier class="rounded-[4px] border-fin border-default bg-overlay px-2 py-[2px]" [attr.title]="v.note">À vérifier</span>
              }
              <span>relevé le {{ releve() }}</span>
              @if (l.doc_url) {
                <a data-doc [href]="l.doc_url" target="_blank" rel="noopener noreferrer" class="text-secondary underline hover:text-primary">Doc officielle</a>
              }
            </div>
          }
          @if (defautTexte(); as t) { <p data-defaut class="m-0 text-[11px] text-secondary">{{ t }}</p> }
        }

        @if (choix(); as c) {
          @if (!exacte()) {
            @if (c.maille === 'cercle' && rayon(); as r) {
              <div data-rayon class="flex flex-col gap-1">
                <div class="flex items-baseline gap-2">
                  <span class="text-[11px] text-secondary">Rayon</span>
                  <span class="font-mono text-[11px] text-primary">{{ kmTexte() }} km</span>
                </div>
                <input type="range" [min]="r.min" [max]="r.max" [step]="r.pas" [value]="rayonLocal()"
                  (input)="rayonLocal.set(valeurDe($event))" (pointerup)="relacherRayon()" (touchend)="relacherRayon()" (keyup)="relacherRayon()" (change)="relacherRayon()"
                  aria-label="Rayon des cercles" class="w-full accent-teal" />
                @if (rayonDefautTexte(); as t) { <p data-rayon-defaut class="m-0 text-[11px] text-secondary">{{ t }}</p> }
              </div>
            }
            @if (c.maille !== 'polygone') {
              <mg-dilution [seuil]="c.seuil" [visee]="bilan()?.resume?.couverte ?? 0" [achetee]="bilan()?.resume?.achetee ?? 0"
                [titre]="unite().titre" [sujet]="unite().sujet" [accord]="unite().accord" [complement]="unite().complement" [libelleCurseur]="curseur()" (seuilChange)="regler({ seuil: $event })" />
            }
          }
        }

        @if (jeu.enCours()[plateforme()]) { <div data-conversion class="font-mono text-[11px] text-tertiary">Conversion…</div> }
        @if (jeu.erreurs()[plateforme()]; as e) { <div data-erreur role="alert" [class]="encartErreur">{{ e }}</div> }
        @if (jeu.rayonsProposes()[plateforme()]; as p) {
          <button type="button" data-rayon-propose (click)="regler({ rayon: p.rayon_m })"
            [class]="pastille + ' self-start ' + pastilleInactive">Passer à {{ km(p.rayon_m) }} km</button>
        }
        @if (motifVide(); as m) { <div data-motif-vide [class]="encartAvertissement">{{ m }}</div> }

        @if (bilan(); as b) {
          @if (b.resume.exacte) {
            <div data-exacte class="flex flex-col gap-1">
              <span class="text-[12px] text-primary">Exacte : aucune perte</span>
              <span class="font-mono text-[11px] text-secondary">{{ unitesTexte() }} · {{ nombre(b.resume.population) }} habitants carroyés</span>
              @if (codesPays(); as codes) { <span data-codes-pays class="font-mono text-[11px] text-secondary">{{ codes }}</span> }
              @for (u of unitesPays(); track u.code) { <span data-unite-pays class="font-mono text-[11px] text-tertiary">{{ u.texte }}</span> }
              @if (diffusionInconnue(); as d) {
                <span data-population-inconnue class="text-[11px] text-secondary">{{ libellePopulationInconnue }} : <span class="font-mono text-primary">{{ d }}</span></span>
              }
            </div>
          } @else {
            <dl data-chiffres class="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
              <dt class="text-secondary">{{ libelleRetenues() }}</dt>
              <dd data-unites class="m-0 text-right font-mono text-primary">{{ nombre(b.resume.n_unites) }} / {{ nombre(b.resume.n_touchees) }}</dd>
              <dt class="text-secondary">Taux d’utile</dt>
              <dd data-taux class="m-0 text-right font-mono text-primary">{{ tauxTexte() }}</dd>
              <dt class="text-secondary">Habitants manqués</dt>
              <dd data-manques class="m-0 text-right font-mono text-primary">{{ nombre(b.resume.manques) }} <span class="text-tertiary">({{ partManquee() }} de la zone)</span></dd>
              <dt class="text-secondary">Diffusion hors zone</dt>
              <dd data-hors-zone class="m-0 text-right font-mono text-primary">{{ nombre(b.resume.hors_zone) }}</dd>
              @if (diffusionInconnue(); as d) {
                <dt class="text-secondary">{{ libellePopulationInconnue }}</dt>
                <dd data-population-inconnue class="m-0 text-right font-mono text-primary">{{ d }}</dd>
              }
            </dl>
            @if (chevauchement(); as t) { <p data-chevauchement class="m-0 text-[11px] text-tertiary">{{ t }}</p> }
          }
          @for (a of avertissements(); track a) { <div data-avertissement [class]="encartAvertissement">{{ a }}</div> }
        }

        <!-- T11 : la plateforme REGARDÉE sur la carte (une à la fois, A-14). -->
        @if (choix()) {
          <button type="button" data-voir-carte (click)="carte.regarder(plateforme())" [attr.aria-pressed]="surLaCarte()"
            [class]="pastille + ' self-start ' + (surLaCarte() ? pastilleActive : pastilleInactive)">{{ surLaCarte() ? 'Sur la carte' : 'Voir sur la carte' }}</button>
          @if (surLaCarte() && carte.chargement()) { <div class="font-mono text-[11px] text-tertiary">Chargement des contours…</div> }
          @if (surLaCarte()) {
            <div data-legende-part class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-tertiary">
              <span>Part</span>
              @for (p of paliers; track p.libelle) {
                <span class="inline-flex items-center gap-1"><span class="inline-block size-2.5 rounded-[2px] border-fin border-[var(--text-tertiary)]" [style.background]="p.couleur"></span>{{ p.libelle }}</span>
              }
              <span>· non retenu : contour fin</span>
            </div>
          }
          @if (surLaCarte() && carte.communesTronquees()) {
            <div data-communes-tronquees class="text-[11px] text-secondary">{{ texteCommunesTronquees }}</div>
          }
          @if (surLaCarte() && carte.communesIllisibles()) {
            <div data-communes-illisibles class="text-[11px] text-secondary">{{ texteCommunesIllisibles }}</div>
          }
          @if (surLaCarte() && carte.irisSousLeZoom()) { <div data-zoomer class="text-[11px] text-secondary">Zoomez pour voir les IRIS sur la carte (à partir du zoom 9).</div> }
        }
      </div>
    }
  `,
})
export class ColonnePlateformeComponent {
  protected readonly jeu = inject(JeuZonesService);
  /** La carte de ⑤ (fournie par la page) : « Voir sur la carte » y pose CETTE plateforme. */
  protected readonly carte = inject(JeuCarteService);

  readonly plateforme = input.required<Plateforme>();
  /** Dépliée : toujours en colonnes côte à côte ; une seule à la fois quand elles s'empilent. */
  readonly ouverte = input(true);
  /** Empilées : l'en-tête déplie la colonne. */
  readonly repliable = input(false);
  readonly basculer = output<void>();

  protected readonly encartErreur = ENCART_ERREUR;
  protected readonly encartAvertissement = ENCART_AVERTISSEMENT_LISIBLE;
  protected readonly nombre = formaterNombre;
  /** La légende des parts de la carte, celle de ④ (`libellesPaliers`, couleurs en jetons CSS : ici c'est du HTML). */
  protected readonly paliers = libellesPaliers().map((libelle, i) => ({ couleur: PALIERS_CSS[i], libelle }));
  protected readonly texteCommunesTronquees = `Plus de ${formaterNombre(MAX_CODES_CONTOURS)} communes touchées : seules les retenues sont dessinées, et chaque seuil relit leurs contours.`;
  protected readonly texteCommunesIllisibles = `Plus de ${formaterNombre(MAX_CODES_CONTOURS)} communes retenues : aucune n’est dessinée. Relevez le seuil pour les voir sur la carte.`;
  protected readonly pastille = PASTILLE;
  protected readonly pastilleActive = PASTILLE_PRIMAIRE_ACTIVE;
  protected readonly pastilleInactive = PASTILLE_INACTIVE;
  /** Cette plateforme est peinte sur la carte. */
  protected readonly surLaCarte = computed(() => this.carte.affichee() && this.carte.regardee() === this.plateforme());

  protected readonly nom = computed(() => NOM_PLATEFORME[this.plateforme()]);
  protected readonly lignes = computed(() => this.jeu.plateformes().filter((l) => l.plateforme === this.plateforme()));
  /**
   * Les mailles offertes au choix (⑤ finitions, A-3, Q-4) : une maille SANS OBJET pour la recette (`mailleSansObjet`)
   * est grisée avec sa phrase sur une zone pays (cercles, communes, IRIS) ; sur toute autre zone, la seule maille sans
   * objet est le pays, qui ne s'affiche pas.
   */
  protected readonly lignesChoix = computed(() => {
    const recette = this.jeu.recette();
    return this.lignes().flatMap((l) => {
      const raison = mailleSansObjet(recette, l.maille);
      if (!raison) return [l];
      return recette?.type === 'pays' ? [{ ...l, disponible: false, note: raison }] : [];
    });
  });
  protected readonly choix = computed(() => this.jeu.choix()[this.plateforme()]);
  protected readonly ligne = computed(() => {
    const m = this.choix()?.maille;
    return this.lignes().find((l) => l.maille === m);
  });
  protected readonly bilan = computed(() => this.jeu.resumes()[this.plateforme()]);
  /**
   * Le badge neutre « À vérifier » et son infobulle : la ligne entière (`a_verifier`, sa note), ou le seul ciblage pays
   * de « France entière » (`paysAVerifier` : les DROM comme pays distincts) — jamais celui de la métropole. Deux textes
   * SÉPARÉS (relecture 2) : la note de la ligne ne vaut que pour la ligne (sql/301 en a retiré les DROM), la réserve
   * « France entière » s'y ajoute pour la seule recette FR — TTD sur la métropole ne parle donc plus de FR + DROM.
   */
  protected readonly aVerifier = computed(() => {
    const l = this.ligne();
    const pays = paysAVerifier(this.jeu.recette(), l);
    if (!l?.a_verifier && !pays) return null;
    const notes = [l?.a_verifier ? l.note : null, pays ? NOTE_PAYS_A_VERIFIER : null].filter((n): n is string => !!n);
    return { note: notes.length ? notes.join(' ') : null };
  });
  /** B9 (ARB-7, Q7 = A) : la ligne qui explique la maille par défaut, tant que c'est elle qui est choisie ; sinon `null`. */
  protected readonly defautTexte = computed(() => {
    const d = this.jeu.defauts()[this.plateforme()];
    return d && d.maille === this.choix()?.maille ? texteDefaut(d) : null;
  });
  /** Les codes ciblés par une plateforme au pays (« FR, GP, MQ… ») ; `null` pour une autre maille. */
  protected readonly codesPays = computed(() => this.bilan()?.pays?.map((u) => u.code).join(', ') || null);
  /** Une ligne par territoire, dès qu'il y en a plus d'un (« France entière ») : sa population, ou « non carroyée ». */
  protected readonly unitesPays = computed(() => {
    const pays = this.bilan()?.pays ?? [];
    return pays.length > 1 ? pays.map((u) => ({ code: u.code, texte: texteUnitePays(u) })) : [];
  });
  /** A4 (ARB-3) : la ligne séparée « Diffusion à population inconnue », quand une telle unité est retenue ; sinon `null`. */
  protected readonly libellePopulationInconnue = LIBELLE_POPULATION_INCONNUE;
  protected readonly diffusionInconnue = computed(() => texteDiffusionInconnue(this.bilan()?.resume.n_inconnues, this.choix()?.maille ?? 'cp'));
  /** A6 (sql/311) : cercles — la somme des disques dépasse la diffusion achetée (chevauchements) ; sinon `null`. */
  protected readonly chevauchement = computed(() => {
    const b = this.bilan();
    return b ? texteChevauchement(b.resume) : null;
  });
  protected readonly unite = computed(() => UNITE_MAILLE[this.choix()?.maille ?? 'cp']);
  protected readonly curseur = computed(() => libelleCurseurSeuil(this.choix()?.maille ?? 'cp'));
  protected readonly releve = computed(() => dateReleve(this.ligne()?.releve_le ?? ''));
  /** Exacte pour la recette et le rayon choisi (A-6) : ni seuil ni rayon à régler, rien n'est perdu. */
  protected readonly exacte = computed(() => {
    const c = this.choix();
    const l = this.ligne();
    return !!c && !!l && estExacte(c, l, this.jeu.recette());
  });
  protected readonly rayon = computed(() => {
    const c = this.choix();
    return c?.rayon_m === undefined ? null : bornesRayon(this.ligne(), this.jeu.plateformes(), c.rayon_m);
  });
  /** La valeur sous le doigt, réalignée sur le choix dès qu'il change. */
  protected readonly rayonLocal = linkedSignal(() => this.choix()?.rayon_m ?? 0);
  protected readonly libelleRetenues = computed(() => {
    const u = this.unite();
    return this.choix()?.maille === 'cercle' ? 'Cercles retenus / cellules examinées' : `${capitale(u.plusieurs)} retenu${u.accord}s / touché${u.accord}s`;
  });
  protected readonly partManquee = computed(() => {
    const r = this.bilan()?.resume;
    const population = r ? r.manques + r.couverte : 0;
    return r && population > 0 ? `${formaterDecimal((100 * r.manques) / population)} %` : '—';
  });
  protected readonly avertissements = computed(() => {
    const b = this.bilan();
    const m = this.choix()?.maille;
    return b && m ? b.avertissements.map((a) => texteAvertissement(a, m)) : [];
  });
  /** Un pavage lu qui ne retient aucun cercle : sa cause, jamais un « 0 » muet. */
  protected readonly motifVide = computed(() => {
    const motif = this.bilan() ? this.jeu.cercles()[this.plateforme()]?.motif_vide : null;
    return motif ? MESSAGE_MOTIF_VIDE[motif] : null;
  });

  protected readonly tauxTexte = computed(() => {
    const t = this.bilan()?.resume.taux_utile ?? null;
    return t === null ? '—' : `${formaterDecimal(t)} %`;
  });
  protected readonly kmTexte = computed(() => formaterDecimal(this.rayonLocal() / M_PAR_KM));
  protected readonly km = (m: number) => formaterDecimal(m / M_PAR_KM);
  /**
   * B10 : d'où vient le rayon par défaut (surface de la zone, borne de la plateforme, ou repli), tant que le rayon choisi
   * EST ce défaut et qu'aucun jeu ouvert ne porte le sien ; sinon `null`.
   */
  protected readonly rayonDefautTexte = computed(() => {
    const c = this.choix();
    if (c?.maille !== 'cercle' || this.jeu.jeu()) return null;
    const d = rayonDefautExplique(this.ligne(), this.jeu.recette(), this.jeu.surface());
    return d.rayon_m === c.rayon_m ? texteRayonDefaut(d, this.plateforme()) : null;
  });
  protected readonly unitesTexte = computed(() => nombreUnites(this.bilan()?.resume.n_unites ?? 0, this.choix()?.maille ?? 'polygone'));

  protected regler(r: { maille?: Maille; seuil?: number; rayon?: number }): void {
    this.jeu.regler(this.plateforme(), r);
  }

  protected relacherRayon(): void {
    const v = this.rayonLocal();
    if (v !== this.choix()?.rayon_m) this.regler({ rayon: v });
  }

  protected valeurDe(ev: Event): number {
    return Number((ev.target as HTMLInputElement).value);
  }

}

function capitale(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

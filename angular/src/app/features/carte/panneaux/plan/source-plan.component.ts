import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { map } from 'rxjs';
import { messageErreurApi } from '../../../../core/http/erreurs';
import { formaterDecimal, formaterNombre } from '../../../../core/format/nombre';
import { dateFr } from '../../../risques/etapes/zones/panneau-extractions.component';
import { type ExtractionJeu, type JeuListe, JeuxApi } from '../../data/jeux.api';
import { JeuZonesService } from '../../etat/jeu-zones.service';
import { LectureAnnulable } from '../../etat/lecture-annulable';
import { PlanCampagneService } from '../../etat/plan-campagne.service';
import { NOM_PLATEFORME, UNITE_MAILLE } from '../../logique/jeu/ecran';
import { resolveChannelAvailability } from '../../logique/plan/canaux';
import { poserExtraction } from '../../logique/plan/plateformes-canaux';
import { ENCART_ERREUR, LIBELLE_CHAMP, PASTILLE, PASTILLE_INACTIVE } from '../analyse/styles-analyse';

/** `GET /api/zones/jeux/[id]/extractions` : les versions d'un jeu, et le jeu lui-même (nom, version). */
type VersionsJeu = { extractions: ExtractionJeu[]; jeu: { id: string; nom: string; version: number } };

/** Où se fige un jeu qui n'a pas encore d'extraction (A-3). */
const SANS_EXTRACTION: Readonly<Record<JeuListe['type'], string>> = {
  zone: 'Aucune extraction : fige-la à l’étape ⑤',
  risque: 'Aucune extraction : fige-la dans le module risque',
};
const BADGE_TYPE: Readonly<Record<JeuListe['type'], string>> = { zone: 'Zone', risque: 'Risque' };

/**
 * ⑥ Plan — la source du plan géographique (lot 6, T4) : port de `SourcePlan` (`components/campaign/wizard/steps/
 * SourcePlan.tsx`), DÉPLACÉ de l'étape Pression de React en section Cible et ÉTENDU (A-3) — la cible V1 est
 * l'EXTRACTION figée d'un jeu de zones, des deux types (Q-1) ; l'indicateur INSEE de React n'est pas porté (A-9).
 *
 * ── LECTURES, UNE À LA FOIS ──────────────────────────────────────────────
 * Rien avant la fin du préremplissage de la campagne (`prerempli`, ≤ 3 appels simultanés). Puis la liste des jeux
 * (`GET /api/zones/jeux?type=tous`, une fois par composant), puis — APRÈS elle — les versions du jeu déjà choisi par le
 * brouillon. Les versions d'un autre jeu ne sont lues qu'au CLIC sur ce jeu (une extraction est figée : jamais
 * relues). Un jeu sans extraction (`n_extractions` de la liste, relecture 2) est GRISÉ d'emblée, avec l'endroit où le figer.
 *
 * Choisir une version : `poserExtraction` (jeu + extraction au brouillon, plateformes re-pré-cochées, A-5) par
 * `PlanCampagneService.modifier` — autosauvé. Le jeu ouvert à l'étape ⑤ (`?jeu=&x=`) est PROPOSÉ, jamais pris d'office
 * (patron lot 5, A-13). L'extraction choisie montre ses chiffres figés : codes postaux retenus, taux d'utile, part du
 * plan en zone, résumé par plateforme — et la phrase de React, sans sa fin sur le multiplicateur d'enchère (A-6).
 */
@Component({
  selector: 'mg-source-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-1.5', 'data-source-plan': '' },
  template: `
    <div [class]="libelleChamp">Source du plan géographique</div>
    @if (proposition(); as p) {
      <button type="button" data-proposition [class]="pastille + ' self-start text-left'" (click)="prendreProposition(p.id, p.x)">
        Partir de l’extraction ouverte à l’étape ⑤{{ p.nom ? ' : ' + p.nom + ' v' + p.x : '' }}
      </button>
    }
    @if (jeux.enCours()) { <div class="font-mono text-[11px] text-tertiary">Lecture des jeux de zones…</div> }
    @if (jeux.erreur(); as e) { <div role="alert" [class]="encartErreur">La liste des jeux de zones est indisponible. {{ e }}</div> }
    @if (jeux.resultat()?.length === 0) {
      <p data-aucun-jeu class="m-0 text-[11px] leading-[1.6] text-secondary">Aucun jeu de zones enregistré : fais-en un à l’étape ⑤, puis fige-le en extraction.</p>
    }
    <div class="flex flex-col gap-1">
      @for (l of lignes(); track l.id) {
        <button type="button" [attr.data-jeu]="l.id" [disabled]="l.sansExtraction || !plan.prerempli()" [attr.aria-pressed]="l.id === jeuOuvert()"
                (click)="ouvrir(l.id)"
                class="flex w-full flex-col items-start gap-[2px] rounded-[4px] border-fin px-[10px] py-2 text-left enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                [class]="l.id === jeuOuvert() ? 'border-teal' : 'border-subtle'">
          <span class="flex w-full items-center gap-2 text-[12px] text-primary">
            <span class="min-w-0 truncate">{{ l.nom }}</span>
            <span data-badge-type class="shrink-0 rounded-[4px] border-fin border-default bg-overlay px-1.5 py-px text-[10px] text-tertiary">{{ l.badge }}</span>
          </span>
          @if (l.sansExtraction) { <span data-sans-extraction class="text-[11px] text-tertiary">{{ l.sansExtraction }}</span> }
        </button>
        @if (l.id === jeuOuvert()) {
          @if (versions.enCours()) { <div class="pl-3 font-mono text-[11px] text-tertiary">Lecture des extractions…</div> }
          @if (versions.erreur(); as e) { <div role="alert" [class]="encartErreur">{{ e }}</div> }
          @if (versionAbsente(); as m) { <div data-version-absente role="status" class="pl-3 text-[11px] text-secondary">{{ m }}</div> }
          <div class="flex flex-col gap-1 pl-3" data-versions>
            @for (v of versionsOuvertes(); track v.id) {
              <button type="button" [attr.data-extraction]="v.id" [attr.aria-pressed]="v.id === extractionChoisie()" (click)="choisir(v.id)"
                      class="flex w-full cursor-pointer flex-col items-start gap-[2px] rounded-[4px] border-fin px-[10px] py-1.5 text-left text-[11px]"
                      [class]="v.id === extractionChoisie() ? 'border-teal text-primary' : 'border-subtle text-secondary hover:text-primary'">
                <span>v{{ v.version }} <span class="text-tertiary">· {{ v.date }}</span></span>
                @if (v.commentaire) { <span class="text-tertiary">{{ v.commentaire }}</span> }
              </button>
            }
          </div>
        }
      }
    </div>

    @if (choisie(); as c) {
      <div data-extraction-choisie class="mt-1.5 flex flex-col gap-1.5 rounded-[8px] border-fin border-subtle bg-elevated px-3 py-2.5 text-[11.5px] leading-[1.65] text-secondary">
        <span data-chiffres-extraction>
          <span class="font-mono text-primary">{{ c.retenus }}</span> codes postaux retenus, taux d’utile
          <span class="font-mono text-primary">{{ c.utile }}</span>, <span class="font-mono text-primary">{{ c.enZone }}</span> du plan en zone.
        </span>
        @if (c.plateformes) { <span data-plateformes-extraction class="font-mono text-[10px]">{{ c.plateformes }}</span> }
        <span data-phrase-plan>Le plan vient du jeu de zones <strong class="font-medium text-primary">{{ c.nom }}</strong> : ce sont ses poids par classe qui répartissent le budget.</span>
      </div>
    }
  `,
})
export class SourcePlanComponent {
  protected readonly plan = inject(PlanCampagneService);
  private readonly api = inject(JeuxApi);
  private readonly jeuEtape5 = inject(JeuZonesService);

  protected readonly libelleChamp = LIBELLE_CHAMP;
  protected readonly pastille = `${PASTILLE} ${PASTILLE_INACTIVE}`;
  protected readonly encartErreur = ENCART_ERREUR;

  protected readonly jeux = new LectureAnnulable<JeuListe[]>(messageErreurApi);
  protected readonly versions = new LectureAnnulable<VersionsJeu>(messageErreurApi);
  /** Les versions lues, par jeu : une extraction est figée, une lecture vaut pour toute la vie du composant. */
  private readonly lues = signal<ReadonlyMap<string, VersionsJeu>>(new Map());
  /** Le jeu dont les versions sont dépliées. */
  protected readonly jeuOuvert = signal<string | null>(null);
  /** La version proposée par `?x=` n'est pas (plus) dans le jeu. */
  protected readonly versionAbsente = signal<string | null>(null);

  private readonly jeuChoisi = computed(() => this.plan.brouillon().jeuZones);
  protected readonly extractionChoisie = computed(() => this.jeuChoisi()?.extraction?.id ?? null);
  private readonly catalogue = computed(() => {
    const c = this.plan.canaux();
    return c ? resolveChannelAvailability(c.catalog, c.connectedProviders, c.is_demo) : null;
  });

  protected readonly lignes = computed(() => (this.jeux.resultat() ?? []).map((j) => ({
    id: j.id,
    nom: j.nom,
    badge: BADGE_TYPE[j.type],
    // Dit par la liste (`n_extractions`), d'emblée ; une lecture des versions vide le confirme (extraction supprimée depuis).
    sansExtraction: j.n_extractions === 0 || this.lues().get(j.id)?.extractions.length === 0 ? SANS_EXTRACTION[j.type] : null,
  })));
  protected readonly versionsOuvertes = computed(() => {
    const id = this.jeuOuvert();
    return (id ? this.lues().get(id)?.extractions ?? [] : []).map((x) => ({ id: x.id, version: x.version, date: dateFr(x.created_at), commentaire: x.commentaire }));
  });

  /** L'extraction choisie, avec ses chiffres figés, dès que les versions de son jeu sont lues. */
  protected readonly choisie = computed(() => {
    const j = this.jeuChoisi();
    const x = j?.extraction ? this.lues().get(j.id)?.extractions.find((e) => e.id === j.extraction?.id) : undefined;
    if (!j || !x) return null;
    return {
      nom: j.nom,
      retenus: formaterNombre(x.n_retenus),
      utile: x.taux_utile == null ? '—' : `${formaterDecimal(Number(x.taux_utile))} %`,
      enZone: x.part_plan_en_zone == null ? '—' : `${formaterDecimal(Number(x.part_plan_en_zone), 0)} %`,
      plateformes: (x.plateformes ?? []).map((p) => `${NOM_PLATEFORME[p.plateforme] ?? p.plateforme} : ${formaterNombre(p.n_unites ?? 0)} ${UNITE_MAILLE[p.maille]?.plusieurs ?? p.maille}`
        + `, ${p.exacte ? 'exacte' : p.taux_utile == null ? '—' : `${formaterDecimal(Number(p.taux_utile))} %`}`).join(' · '),
    };
  });

  /** A-3 : l'extraction ouverte à ⑤ (`?jeu=&x=`), proposée tant qu'elle n'est pas celle du brouillon. */
  protected readonly proposition = computed(() => {
    const id = this.jeuEtape5.jeuId();
    const x = this.jeuEtape5.extraction();
    const choisi = this.jeuChoisi();
    if (!id || x === null || !this.plan.prerempli() || (choisi?.id === id && choisi.extraction?.version === x)) return null;
    return { id, x, nom: this.jeux.resultat()?.find((j) => j.id === id)?.nom ?? null };
  });

  constructor() {
    // P-a : l'effet LIT la campagne et la fin de son préremplissage ; la lecture part hors suivi. Une nouvelle
    // campagne déplie le jeu de SON brouillon.
    effect(() => {
      const pret = this.plan.campagne() !== null && this.plan.prerempli() && !this.plan.accesRefuse();
      if (pret) untracked(() => this.demarrer());
    });
  }

  protected ouvrir(id: string): void {
    this.versionAbsente.set(null);
    this.jeuOuvert.set(id);
    this.lireVersions(id);
  }

  protected choisir(extractionId: string): void {
    const id = this.jeuOuvert();
    const lu = id ? this.lues().get(id) : undefined;
    const x = lu?.extractions.find((e) => e.id === extractionId);
    if (lu && x) this.plan.modifier((d) => poserExtraction(d, lu.jeu, x, this.catalogue()));
  }

  /** La proposition acceptée : le jeu est déplié, ses versions lues, et la version `x` choisie dès qu'elle est connue. */
  protected prendreProposition(id: string, version: number): void {
    this.jeuOuvert.set(id);
    this.lireVersions(id, version);
  }

  private demarrer(): void {
    const jeu = this.jeuChoisi()?.id ?? null;
    this.jeuOuvert.set(jeu);
    if (this.jeux.resultat() === null && !this.jeux.enCours()) {
      // Les versions du jeu choisi APRÈS la liste : une lecture à la fois.
      this.jeux.lancer(this.api.lister().pipe(map((r) => r.jeux ?? [])), () => {
        const ouvert = this.jeuOuvert();
        if (ouvert) this.lireVersions(ouvert);
      });
    } else if (jeu) {
      this.lireVersions(jeu);
    }
  }

  private lireVersions(id: string, choisirVersion?: number): void {
    const deja = this.lues().get(id);
    const choisir = (r: VersionsJeu) => {
      const x = choisirVersion === undefined ? undefined : r.extractions.find((e) => e.version === choisirVersion);
      if (x) this.plan.modifier((d) => poserExtraction(d, r.jeu, x, this.catalogue()));
      // Une proposition `?x=` dont la version n'existe plus : dit, jamais un clic sans effet (relecture 2, M-4).
      else if (choisirVersion !== undefined) this.versionAbsente.set(`La version v${choisirVersion} de ce jeu n’existe plus.`);
    };
    if (deja) return choisir(deja);
    this.versionAbsente.set(null);
    this.versions.lancer(this.api.extractions(id), (r) => {
      this.lues.update((m) => new Map(m).set(id, r));
      // Le résumé figé de l'extraction choisie sert aussi aux sections Plateformes et Impressions (T5).
      this.plan.retenirExtractions(id, r.extractions);
      choisir(r);
    });
  }
}

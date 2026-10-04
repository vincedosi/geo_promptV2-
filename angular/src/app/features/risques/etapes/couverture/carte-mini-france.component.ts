import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formaterNombre } from '../../../../core/format/nombre';
import {
  type Boite, COTE_OM, HAUTEUR, LARGEUR, N_CLASSES, type ZoneGeo, cadreDe, centreDe, chemin, elargir, projecteur,
  separerLointains,
} from '../../logique/mini-france';
import { classeDe, seuilsNaturels } from '../../logique/seuils-naturels';

interface Trace {
  code: string;
  nom: string;
  d: string;
  c: [number, number] | null;
  /** Couleur de l'aplat : jeton (`var()`, DOM) ou palette de DONNÉES (A10). Posée par `[style.fill]`. */
  fill: string;
  stroke: string;
  largeurTrait: number;
  titre: string;
}
interface TraceOM extends Trace { boite: Boite; cercle: number | null }
interface Cercle { code: string; cx: number; cy: number; r: number; stroke: string; largeurTrait: number }

const FOND_CERCLES = 'var(--bg-level-2)';

/**
 * La carte de France de l'étape ③ — portage de `components/risques/CarteMiniFrance.tsx` (SVG, pas MapLibre : voir
 * l'en-tête de `logique/mini-france.ts`).
 *
 * Trois décisions de cartographie, reprises telles quelles : seuils NATURELS (Jenks, 5 classes) et non quantiles ;
 * un EFFECTIF en cercles proportionnels (l'AIRE suit la valeur) et jamais en aplat ; les territoires lointains EXPOSÉS
 * en cartouches, cadrés sur leur propre géométrie. Le gris `--donnee-absente` dit « aucune exposition », jamais
 * « faible ».
 *
 * ⚠ Couleurs par `[style.fill]` / `[style.stroke]` et jamais par l'attribut `fill="var(…)"` : un attribut de
 * présentation ne résout pas `var()` partout. Les teintes de la rampe sont la palette de DONNÉES (exception A10).
 */
@Component({
  selector: 'mg-carte-mini-france',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-2' },
  template: `
    <!-- maxHeight en unités de viewport, hauteur auto : à 480 px de panneau la carte carrée dépassait le bas de l'écran. -->
    <svg [attr.viewBox]="viewBox" role="img" [attr.aria-label]="'Carte de France — ' + libelleValeur()"
         class="block h-auto max-h-[38vh] w-full" (mouseleave)="survoler(null)">
      @for (t of tracesMetro(); track t.code) {
        <path [attr.d]="t.d" [attr.data-code]="t.code" [style.fill]="t.fill" [style.stroke]="t.stroke"
              [attr.stroke-width]="t.largeurTrait" class="cursor-pointer transition-[fill] duration-200 ease-[var(--ease-out)]"
              (mouseenter)="survoler(t.code)" (click)="clic.emit(t.code)"><title>{{ t.titre }}</title></path>
      }
      @for (c of cercles(); track c.code) {
        <circle [attr.data-cercle]="c.code" [attr.cx]="c.cx" [attr.cy]="c.cy" [attr.r]="c.r" [style.fill]="teinteForte()"
                fill-opacity="0.55" [style.stroke]="c.stroke" [attr.stroke-width]="c.largeurTrait" pointer-events="none" />
      }
      <!-- Cartouches d'outre-mer, encadrées et légendées : un territoire hors échelle doit se voir comme tel. -->
      @for (t of tracesOM(); track t.code) {
        <g [attr.data-om]="t.code">
          <rect [attr.x]="t.boite.x - 1" [attr.y]="t.boite.y - 1" [attr.width]="coteOm + 2" [attr.height]="coteOm + 2"
                fill="none" [style.stroke]="'var(--border-subtle)'" stroke-width="0.5" />
          <path [attr.d]="t.d" [attr.data-code]="t.code" [style.fill]="t.fill" [style.stroke]="t.stroke"
                [attr.stroke-width]="t.largeurTrait" class="cursor-pointer"
                (mouseenter)="survoler(t.code)" (click)="clic.emit(t.code)"><title>{{ t.titre }}</title></path>
          @if (t.cercle !== null && t.c) {
            <circle [attr.cx]="t.c[0]" [attr.cy]="t.c[1]" [attr.r]="t.cercle" [style.fill]="teinteForte()"
                    fill-opacity="0.55" [style.stroke]="teinteForte()" stroke-width="0.5" pointer-events="none" />
          }
          <text [attr.x]="t.boite.x + coteOm / 2" [attr.y]="t.boite.y + coteOm + 7" text-anchor="middle"
                class="font-mono text-[7px]" [style.fill]="'var(--text-tertiary)'">{{ t.code }}</text>
        </g>
      }
    </svg>

    <!-- Infobulle SOUS la carte : elle ne recouvre jamais le tracé, et reste lisible au clavier. -->
    <div data-role="infobulle" class="min-h-4 text-[11px] text-secondary">
      @if (enAvant()) {
        <span class="text-primary">{{ nomActif() }}</span> — <span class="font-mono">{{ valeurActive() }}</span>
      } @else {
        <span class="text-tertiary">Survolez une unité</span>
      }
    </div>

    <!-- Échelle : les bornes sont ÉCRITES, tout l'intérêt des seuils naturels est de ne PAS être réguliers. -->
    <div class="flex flex-col gap-[3px]">
      <div class="flex h-[6px] overflow-hidden rounded-[3px]">
        @for (c of rampeLegende(); track $index) { <span class="flex-1" [style.background]="c"></span> }
      </div>
      <div data-role="bornes" class="flex justify-between font-mono text-[9px] text-tertiary">
        @for (b of bornesTexte(); track $index) { <span>{{ b }}</span> } @empty { <span>aucune valeur</span> }
      </div>
      <div data-role="libelle-echelle" class="font-mono text-[9px] text-tertiary">
        {{ libelleValeur() }} · seuils naturels{{ mode() === 'cercles' ? ' · aire ∝ valeur' : '' }}
      </div>
      <!-- « Aucune exposition » n'est PAS la valeur la plus faible de la rampe. -->
      <div class="mt-px flex items-center gap-[5px]">
        <span class="h-[6px] w-3 rounded-[2px] border-fin border-[var(--text-tertiary)] bg-[var(--donnee-absente)]"></span>
        <span class="text-[9px] text-tertiary">aucune exposition</span>
      </div>
    </div>
  `,
})
export class CarteMiniFranceComponent {
  readonly zones = input.required<ZoneGeo[]>();
  /** Valeur à représenter, par code d'unité. Absente = unité non exposée. */
  readonly valeurs = input.required<Map<string, number>>();
  /** Ce que la valeur encode — légende et infobulle. */
  readonly libelleValeur = input.required<string>();
  readonly formater = input<(v: number) => string>(formaterNombre);
  /** Les couleurs, du plus faible au plus fort (palette de DONNÉES choisie par l'utilisateur). */
  readonly stops = input.required<string[]>();
  /** `aplat` pour un RAPPORT (part, densité), `cercles` pour un EFFECTIF. */
  readonly mode = input<'aplat' | 'cercles'>('aplat');
  /** Le SURVOL partagé avec le tableau. */
  readonly codeActif = input<string | null>(null);
  /** L'unité sur laquelle CADRER (clic), `null` pour la France entière. Distincte du survol, qui s'efface. */
  readonly cadrageSur = input<string | null>(null);

  readonly survol = output<string | null>();
  /** Un clic SÉLECTIONNE (et recadre) ; il ne descend jamais — c'est le rôle des flèches du tableau. */
  readonly clic = output<string>();

  protected readonly viewBox = `0 0 ${LARGEUR} ${HAUTEUR}`;
  protected readonly coteOm = COTE_OM;
  private readonly survole = signal<string | null>(null);

  /**
   * On ÉCARTE le premier palier : l'extrémité basse des palettes séquentielles est quasi blanche (#FFF5F0), donc
   * indiscernable du fond, donc d'une unité NON DESSINÉE.
   */
  private readonly rampe = computed(() => {
    const s = this.stops();
    return s.length > 2 ? s.slice(1) : s;
  });
  protected readonly teinteForte = computed(() => this.rampe()[this.rampe().length - 1]);

  private readonly separation = computed(() => separerLointains(this.zones()));
  /** Seuls les territoires lointains EXPOSÉS reçoivent un cartouche. */
  private readonly outreMer = computed(() => this.separation().lointains.filter((z) => this.valeurs().has(z.properties.code)));

  private readonly bornes = computed(() => seuilsNaturels([...this.valeurs().values()], Math.min(N_CLASSES, this.rampe().length)));

  /** Rayon d'un cercle proportionnel : l'AIRE suit la valeur, donc le rayon suit sa racine. */
  private readonly maxValeur = computed(() => {
    const v = [...this.valeurs().values()].filter((x) => Number.isFinite(x) && x > 0);
    return v.length > 0 ? Math.max(...v) : 1;
  });

  /** Le cadre de la métropole, ou celui de l'unité SÉLECTIONNÉE (repli sur la France si elle n'est pas dessinée). */
  private readonly projMetro = computed(() => {
    const metropole = this.separation().principal;
    const cible = this.cadrageSur();
    let cadre = cadreDe(metropole);
    if (cible) {
      const z = metropole.find((x) => x.properties.code === cible);
      const c = z ? cadreDe([z]) : null;
      if (c) cadre = elargir(c, 0.18);
    }
    return cadre ? projecteur(cadre, { x: 0, y: 0, w: LARGEUR, h: HAUTEUR - 42 }) : null;
  });

  /** Survol, puis survol du tableau, puis CADRAGE : un geste en cours l'emporte. */
  protected readonly enAvant = computed(() => this.survole() ?? this.codeActif() ?? this.cadrageSur() ?? null);

  private readonly geometrieMetro = computed(() => {
    const proj = this.projMetro();
    if (!proj) return [];
    return this.separation().principal.map((z) => ({
      code: z.properties.code, nom: z.properties.nom, d: chemin(z, proj), c: centreDe(z, proj),
    }));
  });

  private readonly geometrieOM = computed(() => {
    const out: { code: string; nom: string; d: string; c: [number, number]; boite: Boite }[] = [];
    this.outreMer().forEach((z, i) => {
      const boite: Boite = { x: 3 + i * (COTE_OM + 5), y: HAUTEUR - COTE_OM - 10, w: COTE_OM, h: COTE_OM };
      const c = cadreDe([z]);
      if (!c) return;
      out.push({
        code: z.properties.code, nom: z.properties.nom, d: chemin(z, projecteur(c, boite)), boite,
        c: [boite.x + boite.w / 2, boite.y + boite.h / 2],
      });
    });
    return out;
  });

  private readonly couleur = computed(() => {
    const valeurs = this.valeurs();
    const bornes = this.bornes();
    const rampe = this.rampe();
    const cercles = this.mode() === 'cercles';
    return (code: string): string => {
      // En mode cercles, le fond reste NEUTRE : colorer l'aplat ET dimensionner le cercle encoderait deux fois.
      if (cercles) return FOND_CERCLES;
      const c = classeDe(valeurs.get(code), bornes);
      return c < 0 ? 'var(--donnee-absente)' : rampe[Math.min(c, rampe.length - 1)];
    };
  });

  protected readonly tracesMetro = computed<Trace[]>(() => {
    const couleur = this.couleur();
    const enAvant = this.enAvant();
    const valeurs = this.valeurs();
    const fmt = this.formater();
    return this.geometrieMetro().map((g) => ({
      ...g,
      fill: couleur(g.code),
      stroke: enAvant === g.code ? 'var(--brand-teal)' : 'var(--text-tertiary)',
      largeurTrait: enAvant === g.code ? 1.6 : 0.7,
      titre: `${g.nom} — ${valeurs.has(g.code) ? fmt(valeurs.get(g.code) as number) : 'aucune exposition'}`,
    }));
  });

  protected readonly cercles = computed<Cercle[]>(() => {
    if (this.mode() !== 'cercles') return [];
    const valeurs = this.valeurs();
    const max = this.maxValeur();
    const enAvant = this.enAvant();
    const forte = this.teinteForte();
    const out: Cercle[] = [];
    for (const t of this.geometrieMetro()) {
      const v = valeurs.get(t.code);
      if (!t.c || v === undefined || !Number.isFinite(v) || v <= 0) continue;
      out.push({
        code: t.code, cx: t.c[0], cy: t.c[1], r: 2 + Math.sqrt(v / max) * 15,
        stroke: enAvant === t.code ? 'var(--brand-teal)' : forte, largeurTrait: enAvant === t.code ? 1.4 : 0.5,
      });
    }
    return out;
  });

  protected readonly tracesOM = computed<TraceOM[]>(() => {
    const couleur = this.couleur();
    const enAvant = this.enAvant();
    const valeurs = this.valeurs();
    const fmt = this.formater();
    const max = this.maxValeur();
    const cercles = this.mode() === 'cercles';
    return this.geometrieOM().map((g) => ({
      ...g,
      fill: couleur(g.code),
      stroke: enAvant === g.code ? 'var(--brand-teal)' : 'var(--text-tertiary)',
      largeurTrait: enAvant === g.code ? 1.6 : 0.7,
      titre: `${g.nom} — ${fmt(valeurs.get(g.code) as number)}`,
      // React ne filtre pas ici (la valeur existe : seuls les territoires exposés ont un cartouche).
      cercle: cercles ? 2 + Math.sqrt((valeurs.get(g.code) as number) / max) * 15 : null,
    }));
  });

  protected readonly nomActif = computed(() => {
    const code = this.enAvant();
    return [...this.geometrieMetro(), ...this.geometrieOM()].find((t) => t.code === code)?.nom ?? code;
  });

  protected readonly valeurActive = computed(() => {
    const code = this.enAvant();
    const v = code ? this.valeurs().get(code) : undefined;
    return v !== undefined ? this.formater()(v) : 'aucune exposition';
  });

  protected readonly rampeLegende = computed(() => this.rampe().slice(0, Math.max(this.bornes().length, 1)));
  protected readonly bornesTexte = computed(() => this.bornes().map((b) => this.formater()(b)));

  protected survoler(code: string | null): void {
    this.survole.set(code);
    this.survol.emit(code);
  }
}

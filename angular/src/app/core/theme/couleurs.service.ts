import { DOCUMENT, Injectable, Injector, type Signal, computed, inject } from '@angular/core';
import { DemarrageService } from '../demarrage/demarrage.service';
import { ThemeService } from './theme.service';

/** Ce que `paletteDuTheme` lit d'une règle CSSOM : la surface commune à `CSSStyleRule`, `CSSLayerBlockRule`, `CSSMediaRule`. */
export interface RegleCss {
  selectorText?: string;
  style?: { getPropertyValue(n: string): string; length: number; item(i: number): string };
  cssRules?: ArrayLike<RegleCss>;
}

/**
 * Les propriétés `--x` déclarées par les règles dont la LISTE de sélecteurs contient exactement `selecteur`
 * (`:root, :host` contient `:host` ; `html.light, :host(.light)` contient `:host(.light)`), en descendant dans les
 * `@layer` et `@media`. Plusieurs blocs portent le même sélecteur (Tailwind pose son `@theme` sur `:root, :host`) :
 * le dernier déclaré l'emporte, comme dans la cascade.
 */
export function jetonsDuBloc(regles: ArrayLike<RegleCss>, selecteur: ':host' | ':host(.light)'): Map<string, string> {
  const sortie = new Map<string, string>();
  const parcourir = (liste: ArrayLike<RegleCss>) => {
    for (let i = 0; i < liste.length; i++) {
      const r = liste[i];
      if (r.selectorText && r.style && r.selectorText.split(',').some((s) => s.trim() === selecteur)) {
        for (let j = 0; j < r.style.length; j++) {
          const nom = r.style.item(j);
          if (nom.startsWith('--')) sortie.set(nom, r.style.getPropertyValue(nom).trim());
        }
      }
      if (r.cssRules) parcourir(r.cssRules);
    }
  };
  parcourir(regles);
  return sortie;
}

const REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/;

/**
 * Les couleurs CALCULÉES des jetons de `styles/jetons.css`, pour les
 * bibliothèques qui ne savent pas lire `var()` : MapLibre (`paint`) et ECharts.
 *
 * Côté React, ces bibliothèques recevaient des tables d'hexadécimaux recopiées
 * des jetons (`lib/carte/palette-zones-risque.ts`, `lib/campagne/palette-*.ts`),
 * tenues à jour à la main et par des tests de parité. Ici, la valeur est LUE
 * dans le CSS au moment de l'affichage : il n'existe qu'une définition.
 */
@Injectable({ providedIn: 'root' })
export class CouleursService {
  private readonly doc = inject(DOCUMENT);
  private readonly theme = inject(ThemeService);
  /** Lu à la demande : `DemarrageService` n'a pas à être construit pour les palettes du thème COURANT. */
  private readonly injecteur = inject(Injector);

  palette<K extends string>(jetons: Record<K, string>): Signal<Record<K, string>> {
    return computed(() => {
      this.theme.themeApplique();
      // Les jetons vivent sur l'hôte de la racine d'ombre (`:host`), plus sur <html> ;
      // repli sur <html> tant qu'aucune racine n'est montée (specs, page hors racine).
      const style = this.doc.defaultView!.getComputedStyle(this.theme.racine() ?? this.doc.documentElement);
      const sortie = {} as Record<K, string>;
      for (const cle of Object.keys(jetons) as K[]) {
        const nom = `--${jetons[cle]}`;
        const valeur = style.getPropertyValue(nom).trim();
        if (!valeur) {
          throw new Error(`Jeton de couleur inconnu : ${nom} (voir angular/src/styles/jetons.css).`);
        }
        sortie[cle] = valeur;
      }
      return sortie;
    });
  }

  /**
   * Les couleurs d'UN thème donné, quel que soit le thème courant (A11) — pour une carte dont le fond ne change pas
   * avec le thème (Positron) et qui peint donc toujours la même palette : la carte des codes postaux (`--seq-*`
   * SOMBRES, `CarteCodesPostaux.tsx:77`), la carte de diffusion ⑤ (palette CLAIRE).
   *
   * `getComputedStyle` ne rend que le thème APPLIQUÉ : les valeurs sont donc lues dans les RÈGLES de la feuille
   * construite `magelian.css` (`DemarrageService.feuille()`), bloc `:root, :host` (sombre) puis, pour le clair,
   * `html.light, :host(.light)` par-dessus — l'élément clair porte les deux, comme dans la cascade. Une valeur
   * `var(--y)` est résolue dans le même thème. Jamais un hexadécimal recopié : une seule définition, `jetons.css`.
   */
  paletteDuTheme<K extends string>(jetons: Record<K, string>, theme: 'clair' | 'sombre'): Record<K, string> {
    let regles: ArrayLike<RegleCss> = [];
    try {
      regles = (this.injecteur.get(DemarrageService).feuille()?.cssRules ?? []) as ArrayLike<RegleCss>;
    } catch {
      // `cssRules` lève (SecurityError) sur une feuille d'une autre origine : repli ci-dessous.
    }
    const valeurs = jetonsDuBloc(regles, ':host');
    if (theme === 'clair') for (const [nom, v] of jetonsDuBloc(regles, ':host(.light)')) valeurs.set(nom, v);
    // Repli (coût écrit dans A11) : une feuille illisible — absente, ou d'une origine qui en interdit la lecture — rend
    // les couleurs du thème COURANT. Écart visuel, jamais un chiffre faux ; un jeton inconnu des deux côtés lève.
    let calcule: CSSStyleDeclaration | null = null;
    const resoudre = (nom: string, profondeur = 0): string => {
      let v = valeurs.get(nom);
      if (!v) {
        calcule ??= this.doc.defaultView!.getComputedStyle(this.theme.racine() ?? this.doc.documentElement);
        v = calcule.getPropertyValue(nom).trim();
      }
      if (!v) throw new Error(`Jeton de couleur inconnu : ${nom} (voir angular/src/styles/jetons.css).`);
      const ref = REFERENCE.exec(v);
      return ref && profondeur < 8 ? resoudre(ref[1], profondeur + 1) : v;
    };
    const sortie = {} as Record<K, string>;
    for (const cle of Object.keys(jetons) as K[]) sortie[cle] = resoudre(`--${jetons[cle]}`);
    return sortie;
  }
}

import { DOCUMENT, Injectable, type Signal, computed, inject } from '@angular/core';
import { ThemeService } from './theme.service';

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

  palette<K extends string>(jetons: Record<K, string>): Signal<Record<K, string>> {
    return computed(() => {
      this.theme.themeApplique();
      const style = this.doc.defaultView!.getComputedStyle(this.doc.documentElement);
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
}

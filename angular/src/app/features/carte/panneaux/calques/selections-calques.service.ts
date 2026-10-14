import { Injectable, signal } from '@angular/core';
import { basculerSection, sectionsInitiales } from '../../etat/sections-filtre';

/**
 * L'état LOCAL du panneau Calques que React gardait dans `PanneauCalques.tsx` (`useState`, `useFilterSections(true, …)`) :
 * les sections internes ouvertes, les régies OOH et les types de transport choisis.
 *
 * Fourni par `mg-panneau-donnees` (② — `mg-panneau-calques` jusqu'à T13) ET, depuis T11b, par `mg-panneau-autres` (sections OOH et radio, régies OOH) : une
 * instance par panneau, fournie par le panneau lui-même. Elle survit au repli d'un groupe (les sections, rendues sous
 * `@if`, sont recréées) ET au changement d'étape ou à la fermeture d'« Autres » : les panneaux sont montés à la première
 * visite puis gardés (arbitrage A1), jamais démontés ; elle ne meurt qu'avec la page (changement d'espace). Mode OVERLAY : rien n'est lu ni écrit dans
 * `localStorage`, et seules les sections territoriales démarrent ouvertes — POI, transport et OOH sont repliées.
 */
@Injectable()
export class SelectionsCalquesService {
  readonly sections = signal<Record<string, boolean>>(sectionsInitiales(true, () => undefined));
  /** Régies OOH choisies (`selectedOOH`, `PanneauCalques.tsx:263`). */
  readonly regiesOoh = signal<readonly string[]>([]);
  /** Types de transport choisis (`selectedTransportTypes`, `PanneauCalques.tsx:264`). */
  readonly typesTransport = signal<readonly string[]>([]);

  basculerSection(cle: string): void {
    this.sections.update((s) => basculerSection(s, cle, true, () => undefined));
  }
}

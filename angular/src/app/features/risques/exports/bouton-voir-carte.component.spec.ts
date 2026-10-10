import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { PONT_CARTE, type PontCarte } from '../../carte/etat/pont-carte';
import { ZonesRisqueApi } from '../data/zones-risque.api';
import { codeProfil } from '../logique/code-profil';
import { PROFIL_DEFAUT, type ProfilRayons } from '../logique/profil';
import {
  BoutonVoirCarteComponent, MESSAGE_AUCUNE_ZONE, MESSAGE_PREPARATION_IMPOSSIBLE, MESSAGE_SANS_REPONSE, messagePreparation,
} from './bouton-voir-carte.component';

const VIDE: ProfilRayons = { haut: [], bas: [], autres: [], lie: false, inclurePPRT: false };

async function rendre(preparer: (code: string, natures: string[]) => unknown, profil = PROFIL_DEFAUT, natures: string[] = []) {
  const ordre: string[] = [];
  const pont: PontCarte = { afficherZonesRisque: vi.fn(() => { ordre.push('afficher'); }) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ZonesRisqueApi, useValue: { preparer: (c: string, n: string[]) => { ordre.push('preparer'); return preparer(c, n); } } },
      { provide: PONT_CARTE, useValue: pont },
    ],
  });
  const f = TestBed.createComponent(BoutonVoirCarteComponent);
  f.componentRef.setInput('profil', profil);
  f.componentRef.setInput('natures', natures);
  const affiche = vi.fn(() => ordre.push('affiche'));
  f.componentInstance.affiche.subscribe(affiche);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  return { f, el, pont, affiche, ordre, bouton: () => el.querySelector('button')! };
}

describe('BoutonVoirCarteComponent', () => {
  it('clic → preparer(code, natures) PUIS afficherZonesRisque({ profil, natures }) PUIS `affiche`', async () => {
    const preparer = vi.fn(() => of({ classes: 4 }));
    const { f, bouton, pont, ordre } = await rendre(preparer, PROFIL_DEFAUT, ['Toxicité aiguë']);
    expect(bouton().textContent?.trim()).toBe('Voir sur la carte');
    expect(bouton().title).toBe('Afficher les zones de ce profil sur la carte');
    bouton().click();
    await f.whenStable();
    expect(preparer).toHaveBeenCalledWith(codeProfil(PROFIL_DEFAUT), ['Toxicité aiguë']);
    expect(pont.afficherZonesRisque).toHaveBeenCalledWith({ profil: PROFIL_DEFAUT, natures: ['Toxicité aiguë'] });
    expect(ordre).toEqual(['preparer', 'afficher', 'affiche']);
  });

  it('pendant la préparation : désactivé, icône qui tourne ; un second clic ne relance rien', async () => {
    const flux = new Subject<unknown>();
    const preparer = vi.fn(() => flux);
    const { f, el, bouton } = await rendre(preparer);
    bouton().click();
    await f.whenStable();
    expect(bouton().disabled).toBe(true);
    expect(el.querySelector('mg-icone.animate-spin')).not.toBeNull();
    bouton().click();
    expect(preparer).toHaveBeenCalledTimes(1);
  });

  it('`classes: 0` → le message de React, rien d’allumé, l’écran reste ouvert', async () => {
    const { f, el, bouton, pont, affiche } = await rendre(() => of({ classes: 0, deja_construit: true }));
    bouton().click();
    await f.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(MESSAGE_AUCUNE_ZONE);
    expect(pont.afficherZonesRisque).not.toHaveBeenCalled();
    expect(affiche).not.toHaveBeenCalled();
    expect(bouton().disabled).toBe(false);
  });

  it('refus de la route → son champ `error` ; sinon le message générique ; sans réponse → « n’a pas répondu »', async () => {
    const refus = new HttpErrorResponse({ status: 500, error: { error: 'Construction des zones impossible.' } });
    const { f, el, bouton, pont } = await rendre(() => throwError(() => refus));
    bouton().click();
    await f.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Construction des zones impossible.');
    expect(pont.afficherZonesRisque).not.toHaveBeenCalled();
    expect(messagePreparation(new HttpErrorResponse({ status: 500, error: 'texte' }))).toBe(MESSAGE_PREPARATION_IMPOSSIBLE);
    expect(messagePreparation(new HttpErrorResponse({ status: 0 }))).toBe(MESSAGE_SANS_REPONSE);
  });

  it('profil sans anneau → désactivé AVANT toute requête, avec le `title` de React, bord neutre', async () => {
    const preparer = vi.fn(() => of({ classes: 1 }));
    const { f, bouton } = await rendre(preparer, VIDE);
    expect(bouton().disabled).toBe(true);
    expect(bouton().title).toBe('Réglez au moins un anneau pour délimiter une zone.');
    expect(bouton().classList).toContain('border-default');
    expect(bouton().classList).toContain('text-tertiary');
    bouton().click();
    await f.whenStable();
    expect(preparer).not.toHaveBeenCalled();
  });
});

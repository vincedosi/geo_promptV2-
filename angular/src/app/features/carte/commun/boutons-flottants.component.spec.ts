import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BoutonsFlottantsComponent, droiteBoutons } from './boutons-flottants.component';

@Component({
  imports: [BoutonsFlottantsComponent],
  template: `<mg-boutons-flottants [railMasque]="masque()" [haut]="masque() ? 10 : 52" (basculerImmersif)="immersif = immersif + 1" (toutEffacer)="effacer = effacer + 1" />`,
})
class Hote {
  readonly masque = signal(false);
  immersif = 0;
  effacer = 0;
}

describe('BoutonsFlottantsComponent — mode immersif et Tout effacer (page.tsx:1334-1376)', () => {
  it('« Tout effacer » 42 px sous le bouton immersif, gomme 16 px, titre de React ; chaque clic émet', async () => {
    const fixture = TestBed.createComponent(Hote);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const immersif = el.querySelector<HTMLButtonElement>('button[data-immersif]')!;
    const effacer = el.querySelector<HTMLButtonElement>('button[data-tout-effacer]')!;
    expect(immersif.style.top).toBe('52px');
    expect(effacer.style.top).toBe('94px');
    expect(effacer.getAttribute('title')).toBe('Tout effacer (couches et zones affichées)');
    expect(effacer.querySelector('mg-icone svg')!.getAttribute('width')).toBe('16');
    effacer.click();
    immersif.click();
    expect(fixture.componentInstance.effacer).toBe(1);
    expect(fixture.componentInstance.immersif).toBe(1);
    fixture.componentInstance.masque.set(true);
    await fixture.whenStable();
    expect(effacer.style.top).toBe('52px');
    expect(immersif.getAttribute('aria-pressed')).toBe('true');
  });

  it('« Script bidding DV360 » : seulement avec une zone du lien, 84 px sous l’immersif, titre nommé, clic émis', async () => {
    const fixture = TestBed.createComponent(HoteScript);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button[data-script-dv360]')).toBeNull();
    fixture.componentInstance.zone.set('CIRFA BRETAGNE');
    await fixture.whenStable();
    const bouton = el.querySelector<HTMLButtonElement>('button[data-script-dv360]')!;
    expect(bouton.style.top).toBe('136px');
    expect(bouton.textContent?.trim()).toBe('Script bidding DV360');
    expect(bouton.getAttribute('title')).toBe('Générer le fichier custom bidding DV360 pour « CIRFA BRETAGNE »');
    bouton.click();
    expect(fixture.componentInstance.scripts).toBe(1);
  });
});

@Component({
  imports: [BoutonsFlottantsComponent],
  template: `<mg-boutons-flottants [railMasque]="false" [haut]="52" [zoneScript]="zone()" (genererScript)="scripts = scripts + 1" />`,
})
class HoteScript {
  readonly zone = signal<string | null>(null);
  scripts = 0;
}

@Component({
  imports: [BoutonsFlottantsComponent],
  template: `<mg-boutons-flottants [railMasque]="false" [haut]="52" [zoneScript]="'Z'" [decalage]="decalage()" [planMedia]="plan()" (rouvrirPlan)="rouvert = rouvert + 1" />`,
})
class HotePlan {
  readonly decalage = signal(10);
  readonly plan = signal<number | null>(null);
  rouvert = 0;
}

describe('BoutonsFlottantsComponent — plan média (T15, page.tsx:1113-1126, 1222-1243)', () => {
  it('tous les boutons s’écartent du plan média ; « Plan média (n) » 126 px sous l’immersif seulement panneau fermé', async () => {
    const fixture = TestBed.createComponent(HotePlan);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button[data-plan-media]')).toBeNull();
    // `min()` n'est pas lu par le DOM de test (la déclaration y est ignorée) : la chaîne est vérifiée ici, son rendu au
    // navigateur (captures T15).
    expect(droiteBoutons(10)).toBe('min(10px, calc(100% - 60px))');
    expect(droiteBoutons(620)).toBe('min(620px, calc(100% - 60px))');

    fixture.componentInstance.plan.set(2);
    await fixture.whenStable();
    const bouton = el.querySelector<HTMLButtonElement>('button[data-plan-media]')!;
    expect(bouton.textContent?.trim()).toBe('Plan média (2)');
    expect(bouton.getAttribute('title')).toBe('Rouvrir le plan média des zones affichées');
    expect(bouton.style.top).toBe('178px');
    bouton.click();
    expect(fixture.componentInstance.rouvert).toBe(1);
  });
});

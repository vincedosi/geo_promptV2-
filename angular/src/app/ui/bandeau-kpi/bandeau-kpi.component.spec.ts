import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KpiComponent } from '../kpi/kpi.component';
import { PerimeDirective } from '../perime/perime.directive';
import { BandeauKpiComponent } from './bandeau-kpi.component';

@Component({
  imports: [BandeauKpiComponent, KpiComponent, PerimeDirective],
  template: `
    <mg-bandeau-kpi consigne="Survolez-en un." definition="La définition complète.">
      <mg-kpi [mgPerime]="true" valeur="1" libelle="a" note="n" accent />
      <mg-kpi [mgPerime]="false" valeur="2" libelle="b" note="n" />
    </mg-bandeau-kpi>`,
})
class Hote {}

describe('BandeauKpiComponent', () => {
  async function rendre() {
    const f = TestBed.createComponent(Hote);
    await f.whenStable();
    return f.nativeElement as HTMLElement;
  }

  it('porte les classes du conteneur React : fond élevé, traits fins haut et bas, 10px 20px, écart 26', async () => {
    const boite = (await rendre()).querySelector('mg-bandeau-kpi > div')!;
    for (const c of ['flex', 'flex-wrap', 'gap-[26px]', 'bg-elevated', 'border-t-fin', 'border-b-fin', 'border-subtle', 'px-5', 'py-[10px]']) {
      expect(boite.classList).toContain(c);
    }
  });

  it('projette les tuiles et pose la consigne avec sa définition en infobulle', async () => {
    const el = await rendre();
    expect(el.querySelectorAll('mg-kpi').length).toBe(2);
    const consigne = el.querySelector('span[title]')!;
    expect(consigne.textContent).toContain('Survolez-en un.');
    expect(consigne.getAttribute('title')).toBe('La définition complète.');
  });

  it('une tuile périmée est estompée', async () => {
    const [a, b] = Array.from((await rendre()).querySelectorAll<HTMLElement>('mg-kpi'));
    expect(a.style.opacity).toBe('0.42');
    expect(b.style.opacity).toBe('1');
  });
});

import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PileEchapService } from '../etat/pile-echap.service';
import { JeuxDeZonesComponent } from '../panneaux/zones/jeux-de-zones.component';
import { MesZonesComponent } from '../panneaux/zones/mes-zones.component';
import { OutilMesZonesComponent } from './outil-mes-zones.component';
import { OutilsCarteService } from './outils-carte.service';

/** Les deux listes, réduites à leur sélecteur : ce spec vérifie le câblage du tiroir, leurs specs vérifient le reste. */
@Component({ selector: 'mg-jeux-de-zones', template: '' })
class JeuxFactices {
  readonly revision = input(0);
  readonly visible = input(true);
}
@Component({ selector: 'mg-mes-zones', template: '' })
class MesZonesFactice {
  readonly rafraichir = input(0);
}

async function monter() {
  TestBed.configureTestingModule({ providers: [OutilsCarteService, PileEchapService] });
  TestBed.overrideComponent(OutilMesZonesComponent, {
    remove: { imports: [JeuxDeZonesComponent, MesZonesComponent] },
    add: { imports: [JeuxFactices, MesZonesFactice] },
  });
  const fixture = TestBed.createComponent(OutilMesZonesComponent);
  await fixture.whenStable();
  const mesZones = () => fixture.debugElement.query(By.directive(MesZonesFactice)).componentInstance as MesZonesFactice;
  const jeux = () => fixture.debugElement.query(By.directive(JeuxFactices)).componentInstance as JeuxFactices;
  return { fixture, el: fixture.nativeElement as HTMLElement, outils: TestBed.inject(OutilsCarteService), mesZones, jeux };
}

describe('OutilMesZonesComponent — le tiroir « Mes zones » (spec § 6)', () => {
  it('rend les jeux de zones, PUIS « Mes zones » sous son titre', async () => {
    const { el } = await monter();
    const ordre = [...el.querySelectorAll('mg-jeux-de-zones, mg-mes-zones')].map((n) => n.tagName.toLowerCase());
    expect(ordre).toEqual(['mg-jeux-de-zones', 'mg-mes-zones']);
    expect(el.querySelector('[data-section="mes-zones"] h4')!.textContent!.trim()).toBe('Mes zones');
  });

  it('une zone créée (`zonesModifiees`) relit « Mes zones » : `rafraichir` passe à 1 sur la MÊME instance', async () => {
    const { fixture, outils, mesZones } = await monter();
    const avant = mesZones();
    expect(avant.rafraichir()).toBe(0);
    outils.zonesModifiees();
    await fixture.whenStable();
    expect(mesZones()).toBe(avant);
    expect(avant.rafraichir()).toBe(1);
  });

  it('E5 (⑤ finitions, T5) : un jeu enregistré en ⑤ (`jeuxModifies`) périme la liste des jeux, relue quand le tiroir est ouvert', async () => {
    const { fixture, outils, jeux } = await monter();
    expect([jeux().revision(), jeux().visible()]).toEqual([0, false]);
    outils.jeuxModifies();
    outils.ouvrir('zones');
    await fixture.whenStable();
    expect([jeux().revision(), jeux().visible()]).toEqual([1, true]);
  });
});

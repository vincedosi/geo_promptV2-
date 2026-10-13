import { Component, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CaptureService } from '../../etat/capture.service';
import { PileEchapService } from '../../etat/pile-echap.service';
import { OutilsCarteService } from '../../outils/outils-carte.service';
import { CaptureComponent } from './capture.component';
import { CreerCodesPostauxComponent } from './creer-codes-postaux.component';
import { CreerDessinComponent } from './creer-dessin.component';
import { CreerRayonComponent } from './creer-rayon.component';
import { PanneauZonesComponent } from './panneau-zones.component';

/** Les outils de création, réduits à leur sortie `cree` : ce spec vérifie le câblage, leurs specs le reste. */
@Component({ selector: 'mg-creer-codes-postaux', template: '' })
class CodesPostauxFactice { readonly cree = output<void>(); }
@Component({ selector: 'mg-creer-rayon', template: '' })
class RayonFactice { readonly cree = output<void>(); }
@Component({ selector: 'mg-creer-dessin', template: '' })
class DessinFactice { readonly cree = output<void>(); }
@Component({ selector: 'mg-capture', template: '' })
class CaptureFactice { readonly cree = output<void>(); readonly fermer = output<void>(); }

async function monter() {
  TestBed.configureTestingModule({ providers: [OutilsCarteService, PileEchapService, CaptureService] });
  TestBed.overrideComponent(PanneauZonesComponent, {
    remove: { imports: [CaptureComponent, CreerCodesPostauxComponent, CreerDessinComponent, CreerRayonComponent] },
    add: { imports: [CaptureFactice, CodesPostauxFactice, DessinFactice, RayonFactice] },
  });
  const fixture = TestBed.createComponent(PanneauZonesComponent);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement, outils: TestBed.inject(OutilsCarteService) };
}

describe('PanneauZonesComponent — ③ garde « Créer une zone » ; « Mes zones » est dans la boîte à outils (2026-10-13)', () => {
  it('ni jeux de zones ni « Mes zones » dans le panneau : « Créer une zone », puis le renvoi vers l’outil', async () => {
    const { el } = await monter();
    expect(el.querySelector('mg-jeux-de-zones')).toBeNull();
    expect(el.querySelector('mg-mes-zones')).toBeNull();
    expect([...el.querySelectorAll('section[data-section]')].map((s) => s.getAttribute('data-section'))).toEqual(['creer', 'vers-mes-zones']);
  });

  it('« Ouvrir « Mes zones » » ouvre l’outil Mes zones de la boîte à outils', async () => {
    const { el, outils } = await monter();
    const bouton = el.querySelector<HTMLButtonElement>('[data-ouvrir-mes-zones]')!;
    expect(bouton.textContent!.trim()).toBe('Ouvrir « Mes zones »');
    bouton.click();
    expect(outils.outil()).toBe('zones');
  });

  it('chaque zone créée (codes postaux, rayon, dessin) incrémente `revisionZones`', async () => {
    const { fixture, outils } = await monter();
    expect(outils.revisionZones()).toBe(0);
    for (const [i, type] of [CodesPostauxFactice, RayonFactice, DessinFactice].entries()) {
      (fixture.debugElement.query(By.directive(type)).componentInstance as { cree: { emit(): void } }).cree.emit();
      expect(outils.revisionZones()).toBe(i + 1);
    }
  });
});

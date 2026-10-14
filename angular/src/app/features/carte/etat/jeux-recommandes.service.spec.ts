import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CarteApi } from '../data/carte.api';
import { JeuxRecommandesService } from './jeux-recommandes.service';

@Component({ selector: 'mg-hote-essai', template: '', providers: [JeuxRecommandesService] })
class HoteEssai {}

function monter() {
  const reponse = new Subject<{ cles?: string[]; error?: string }>();
  let lectures = 0;
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: CarteApi, useValue: { jeuxRecommandes: () => { lectures++; return reponse.asObservable(); } } },
    ],
  });
  const fixture = TestBed.createComponent(HoteEssai);
  const service = fixture.debugElement.injector.get(JeuxRecommandesService);
  return { fixture, service, reponse, lectures: () => lectures };
}

describe('JeuxRecommandesService', () => {
  it('null pendant la lecture, puis les clés de la réponse ; une seule lecture', () => {
    const { service, reponse, lectures } = monter();
    expect(service.cles()).toBeNull();
    expect(service.indisponible()).toBe(false);
    reponse.next({ cles: ['iris:socio-demo'] });
    expect(service.cles()).toEqual(['iris:socio-demo']);
    expect(service.indisponible()).toBe(false);
    expect(lectures()).toBe(1);
  });

  it('une réponse sans tableau vaut « pas de sélection »', () => {
    const { service, reponse } = monter();
    reponse.next({ error: 'x' });
    expect(service.cles()).toEqual([]);
  });

  it('échec : cles() = [] et indisponible() = true', () => {
    const { service, reponse } = monter();
    reponse.error(new Error('500'));
    expect(service.cles()).toEqual([]);
    expect(service.indisponible()).toBe(true);
  });

  it('détruit pendant la lecture : désabonné', () => {
    const { fixture, reponse } = monter();
    expect(reponse.observed).toBe(true);
    fixture.destroy();
    expect(reponse.observed).toBe(false);
  });
});

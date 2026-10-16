import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfigService } from '../../../core/config/config.service';
import { StreetViewComponent, VARIABLE_CLE_GOOGLE, adresseStreetView } from './street-view.component';

async function monter(cle: string) {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: ConfigService, useValue: { valeur: { googleMapsKey: cle } } }],
  });
  const fixture = TestBed.createComponent(StreetViewComponent);
  fixture.componentRef.setInput('lat', 43.3);
  fixture.componentRef.setInput('lng', 5.4);
  fixture.componentRef.setInput('titre', 'Lieu essai');
  fixture.componentRef.setInput('hauteur', 300);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('mg-street-view', () => {
  it('avec clé : l iframe du point, à la hauteur et au titre donnés', async () => {
    const el = await monter('cle-test');
    const iframe = el.querySelector('iframe[data-street-view]') as HTMLIFrameElement;
    expect(iframe.src).toBe(adresseStreetView('cle-test', 43.3, 5.4));
    expect(iframe.getAttribute('height')).toBe('300');
    expect(iframe.title).toBe('Street View Lieu essai');
    expect(el.querySelector('[data-cle-manquante]')).toBeNull();
  });

  it('sans clé : le bandeau nomme la variable, jamais un cadre vide', async () => {
    const el = await monter('');
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.querySelector('[data-cle-manquante]')!.textContent!.trim()).toBe(`${VARIABLE_CLE_GOOGLE} manquante.`);
  });
});

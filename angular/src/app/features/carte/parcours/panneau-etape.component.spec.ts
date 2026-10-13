import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONSIGNE_ETAPE, type EtapeCarte } from '../logique/parcours';
import { PanneauEtapeComponent } from './panneau-etape.component';

@Component({
  imports: [PanneauEtapeComponent],
  template: `<mg-panneau-etape [etape]="etape()" [masque]="masque()" [(replie)]="replie"><div data-contenu>contenu</div></mg-panneau-etape>`,
})
class Hote {
  readonly etape = signal<EtapeCarte>('donnees');
  readonly masque = signal(false);
  readonly replie = signal(false);
}

async function monter() {
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, hote: fixture.componentInstance, aside: () => el.querySelector('aside')! };
}

/** Un `PointerEvent` de test : jsdom n'en fabrique pas avec `pointerId`. */
function pointeur(type: string, x: number): Event {
  const e = new MouseEvent(type, { clientX: x, bubbles: true });
  Object.defineProperty(e, 'pointerId', { value: 7 });
  return e;
}

describe('PanneauEtapeComponent', () => {
  it('porte la consigne de l’étape et son nom accessible ; projette le contenu', async () => {
    const { el, aside } = await monter();
    expect(aside().getAttribute('aria-label')).toBe('Étape 2 — Données');
    expect(el.querySelector('[data-consigne]')!.textContent!.trim()).toBe(CONSIGNE_ETAPE.donnees);
    expect(aside().querySelector('[data-contenu]')).not.toBeNull();
  });

  it('suit l’étape : changer d’étape change la consigne et le nom, pas l’aside', async () => {
    const { fixture, el, hote, aside } = await monter();
    const avant = aside();
    hote.etape.set('zones');
    await fixture.whenStable();
    expect(aside()).toBe(avant);
    expect(avant.getAttribute('aria-label')).toBe('Étape 4 — Zones');
    expect(el.querySelector('[data-consigne]')!.textContent!.trim()).toBe(CONSIGNE_ETAPE.zones);
  });

  it('largeur 480 par défaut ; la poignée, capturée sur ELLE-MÊME, la règle entre 320 et 900', async () => {
    const { fixture, el, aside } = await monter();
    expect(aside().style.width).toBe('480px');
    const poignee = el.querySelector<HTMLElement>('[role="separator"]')!;
    expect(poignee.getAttribute('aria-valuenow')).toBe('480');
    poignee.setPointerCapture = vi.fn();
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    expect(poignee.setPointerCapture).toHaveBeenCalledWith(7);
    poignee.dispatchEvent(pointeur('pointermove', 700));
    await fixture.whenStable();
    expect(aside().style.width).toBe('680px');
    poignee.dispatchEvent(pointeur('pointermove', 2500));
    await fixture.whenStable();
    expect(aside().style.width).toBe('900px');
    poignee.dispatchEvent(pointeur('pointermove', -1500));
    await fixture.whenStable();
    expect(aside().style.width).toBe('320px');
    // Relâchée, la poignée ne suit plus le pointeur.
    poignee.dispatchEvent(pointeur('pointerup', -1500));
    poignee.dispatchEvent(pointeur('pointermove', 700));
    await fixture.whenStable();
    expect(aside().style.width).toBe('320px');
  });

  it('« Replier » : replie vrai, aside caché et sans largeur, contenu TOUJOURS dans le DOM, poignée absente ; et retour', async () => {
    const { fixture, el, hote, aside } = await monter();
    const avant = aside();
    el.querySelector<HTMLButtonElement>('[data-replier]')!.click();
    await fixture.whenStable();
    expect(hote.replie()).toBe(true);
    expect(aside()).toBe(avant);
    expect(avant.style.visibility).toBe('hidden');
    expect(avant.style.width).toBe('0px');
    expect(avant.querySelector('[data-contenu]')).not.toBeNull();
    expect(el.querySelector('[role="separator"]')).toBeNull();
    hote.replie.set(false);
    await fixture.whenStable();
    expect(aside()).toBe(avant);
    expect(avant.style.visibility).toBe('visible');
    expect(avant.style.width).toBe('480px');
  });

  it('masque (mode immersif) : même chose, sans toucher au repli', async () => {
    const { fixture, el, hote, aside } = await monter();
    hote.masque.set(true);
    await fixture.whenStable();
    expect(aside().style.visibility).toBe('hidden');
    expect(aside().style.width).toBe('0px');
    expect(aside().querySelector('[data-contenu]')).not.toBeNull();
    expect(el.querySelector('[role="separator"]')).toBeNull();
    expect(hote.replie()).toBe(false);
    hote.masque.set(false);
    await fixture.whenStable();
    expect(aside().style.visibility).toBe('visible');
  });
});

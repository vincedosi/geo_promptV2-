import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CONSIGNE_ETAPE, type EtapeCarte } from '../logique/parcours';
import { PanneauEtapeComponent } from './panneau-etape.component';

@Component({
  imports: [PanneauEtapeComponent],
  template: `<mg-panneau-etape [etape]="etape()" [masque]="masque()" [reserveDroite]="reserve()" [(replie)]="replie"><div data-contenu>contenu</div></mg-panneau-etape>`,
})
class Hote {
  readonly etape = signal<EtapeCarte>('donnees');
  readonly masque = signal(false);
  readonly replie = signal(false);
  readonly reserve = signal(0);
}

async function monter() {
  const fixture = TestBed.createComponent(Hote);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const panneau = fixture.debugElement.children[0].componentInstance as PanneauEtapeComponent;
  return { fixture, el, hote: fixture.componentInstance, panneau, aside: () => el.querySelector('aside')! };
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

  it('T4b : une carte FLOTTANTE (absolute, z-40, 12 px du haut et de la gauche, hauteur au contenu bornée, coins 12, bord fin, fond opaque), sans ombre ni flou', async () => {
    const { aside } = await monter();
    for (const c of ['absolute', 'z-40', 'top-3', 'left-3', 'max-h-[calc(100%-24px)]',
      'rounded-[12px]', 'border-fin', 'border-default', 'bg-surface', 'overflow-hidden']) {
      expect(aside().classList, c).toContain(c);
    }
    expect(aside().classList).not.toContain('bottom-3');
    // Sans réserve à droite : la place libre est le conteneur moins le jour des outils et du badge (128) et les marges.
    expect(aside().style.maxWidth).toBe('calc(100% - 152px)');
    expect([...aside().classList].filter((c) => /shadow|blur|backdrop|card-overlay/.test(c))).toEqual([]);
  });

  it('largeur 480 par défaut ; la poignée, BORD DROIT de la carte flottante et capturée sur ELLE-MÊME, la règle entre 320 et 900', async () => {
    const { fixture, el, panneau, aside } = await monter();
    expect(aside().style.width).toBe('480px');
    expect(panneau.emprise()).toBe('min(492px, 100% - 140px)');
    const poignee = el.querySelector<HTMLElement>('[role="separator"]')!;
    expect(poignee.parentElement).toBe(aside());
    expect(poignee.classList).toContain('right-0');
    expect(poignee.getAttribute('aria-valuenow')).toBe('480');
    poignee.setPointerCapture = vi.fn();
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    expect(poignee.setPointerCapture).toHaveBeenCalledWith(7);
    poignee.dispatchEvent(pointeur('pointermove', 700));
    await fixture.whenStable();
    expect(aside().style.width).toBe('680px');
    expect(panneau.emprise()).toBe('min(692px, 100% - 140px)');
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

  it('« Replier » : replie vrai, aside caché et sans emprise, contenu TOUJOURS dans le DOM, poignée absente ; et retour', async () => {
    const { fixture, el, hote, panneau, aside } = await monter();
    const avant = aside();
    el.querySelector<HTMLButtonElement>('[data-replier]')!.click();
    await fixture.whenStable();
    expect(hote.replie()).toBe(true);
    expect(aside()).toBe(avant);
    expect(avant.style.visibility).toBe('hidden');
    expect(panneau.emprise()).toBe('0px');
    expect(avant.querySelector('[data-contenu]')).not.toBeNull();
    expect(el.querySelector('[role="separator"]')).toBeNull();
    hote.replie.set(false);
    await fixture.whenStable();
    expect(aside()).toBe(avant);
    expect(avant.style.visibility).toBe('visible');
    expect(avant.style.width).toBe('480px');
    expect(panneau.emprise()).toBe('min(492px, 100% - 140px)');
  });

  it('masque (mode immersif) : même chose, sans toucher au repli', async () => {
    const { fixture, el, hote, panneau, aside } = await monter();
    hote.masque.set(true);
    await fixture.whenStable();
    expect(aside().style.visibility).toBe('hidden');
    expect(panneau.emprise()).toBe('0px');
    expect(aside().querySelector('[data-contenu]')).not.toBeNull();
    expect(el.querySelector('[role="separator"]')).toBeNull();
    expect(hote.replie()).toBe(false);
    hote.masque.set(false);
    await fixture.whenStable();
    expect(aside().style.visibility).toBe('visible');
  });

  it('T4b : la réserve droite (plan média ouvert : 620) borne la largeur ET l’emprise — le panneau rétrécit au lieu de passer dessous', async () => {
    const { fixture, hote, panneau, aside } = await monter();
    hote.reserve.set(620);
    await fixture.whenStable();
    expect(aside().style.maxWidth).toBe('calc(100% - 772px)');
    expect(panneau.emprise()).toBe('min(492px, 100% - 760px)');
  });

  it('round 1 (I-1) : decalageCarte = 12 + largeur POSÉE — inchangé pendant le glissement, posé au relâcher ; 0 caché', async () => {
    const { fixture, el, hote, panneau } = await monter();
    expect(panneau.decalageCarte()).toBe(492);
    const poignee = el.querySelector<HTMLElement>('[role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    poignee.dispatchEvent(pointeur('pointermove', 650));
    await fixture.whenStable();
    expect(panneau.largeur()).toBe(630);
    expect(panneau.decalageCarte()).toBe(492);
    poignee.dispatchEvent(pointeur('pointerup', 650));
    await fixture.whenStable();
    expect(panneau.decalageCarte()).toBe(642);
    hote.replie.set(true);
    await fixture.whenStable();
    expect(panneau.decalageCarte()).toBe(0);
    hote.replie.set(false);
    hote.masque.set(true);
    await fixture.whenStable();
    expect(panneau.decalageCarte()).toBe(0);
  });

  it('round 1 (m1) : bornée par max-width, la largeur est ramenée à la largeur RENDUE à la saisie et au relâcher — plus de zone morte', async () => {
    const { fixture, el, panneau, aside } = await monter();
    const poignee = el.querySelector<HTMLElement>('[role="separator"]')!;
    poignee.setPointerCapture = vi.fn();
    // Élargie à 900, mais la place libre n'en laisse que 668 (le plan média s'est ouvert) : le rendu est de 668.
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    poignee.dispatchEvent(pointeur('pointermove', 1000));
    await fixture.whenStable();
    expect(panneau.largeur()).toBe(900);
    aside().getBoundingClientRect = () => ({ width: 668 }) as DOMRect;
    poignee.dispatchEvent(pointeur('pointerup', 1000));
    await fixture.whenStable();
    expect(panneau.largeur()).toBe(668);
    expect(poignee.getAttribute('aria-valuenow')).toBe('668');
    expect(panneau.decalageCarte()).toBe(680);
    // Revenir en arrière agit dès le premier pixel.
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    poignee.dispatchEvent(pointeur('pointermove', 480));
    await fixture.whenStable();
    expect(panneau.largeur()).toBe(648);
    poignee.dispatchEvent(pointeur('pointerup', 480));
    // Une largeur rendue sous le minimum (fenêtre étroite) ne descend pas sous 320.
    aside().getBoundingClientRect = () => ({ width: 200 }) as DOMRect;
    poignee.dispatchEvent(pointeur('pointerdown', 500));
    poignee.dispatchEvent(pointeur('pointerup', 500));
    await fixture.whenStable();
    expect(panneau.largeur()).toBe(320);
  });
});

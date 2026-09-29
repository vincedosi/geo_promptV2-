import { TestBed } from '@angular/core/testing';
import { FilEtapesComponent, type EtapeAffichee } from './fil-etapes.component';

const ETAPES: EtapeAffichee[] = [
  { cle: 'a', rang: 1, libelle: 'Premier', renseignee: true },
  { cle: 'b', rang: 2, libelle: 'Deuxième', renseignee: true },
  { cle: 'c', rang: 3, libelle: 'Troisième', renseignee: false },
];

let monte: HTMLElement | null = null;

async function rendre(courante: string) {
  const f = TestBed.createComponent(FilEtapesComponent);
  f.componentRef.setInput('etapes', ETAPES);
  f.componentRef.setInput('courante', courante);
  const choix: string[] = [];
  f.componentInstance.choisir.subscribe((c) => choix.push(c));
  await f.whenStable();
  document.body.appendChild(f.nativeElement);
  monte = f.nativeElement as HTMLElement;
  return { el: f.nativeElement as HTMLElement, choix };
}

describe('FilEtapesComponent', () => {
  afterEach(() => {
    monte?.remove();
    monte = null;
  });


  it('marque l\'étape courante et les étapes renseignées, sauf la courante', async () => {
    const { el } = await rendre('b');
    const boutons = el.querySelectorAll('button');
    expect(boutons[1].getAttribute('aria-current')).toBe('step');
    expect(boutons[0].getAttribute('aria-current')).toBeNull();
    expect(boutons[0].querySelector('[aria-label="renseignée"]')).not.toBeNull();
    expect(boutons[1].querySelector('[aria-label="renseignée"]')).toBeNull();
    expect(boutons[2].querySelector('[aria-label="renseignée"]')).toBeNull();
  });

  it('chaque étape reste cliquable, dans les deux sens', async () => {
    const { el, choix } = await rendre('b');
    el.querySelectorAll('button')[0].click();
    el.querySelectorAll('button')[2].click();
    expect(choix).toEqual(['a', 'c']);
  });

  it('flèches, Début et Fin déplacent l\'étape et le focus, bornés', async () => {
    const { el, choix } = await rendre('a');
    const boutons = el.querySelectorAll('button');
    const touche = (b: Element, key: string) => b.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    touche(boutons[0], 'ArrowLeft');
    touche(boutons[0], 'ArrowRight');
    touche(boutons[1], 'End');
    touche(boutons[2], 'Home');
    expect(choix).toEqual(['a', 'b', 'c', 'a']);
    expect(document.activeElement).toBe(boutons[0]);
  });
});

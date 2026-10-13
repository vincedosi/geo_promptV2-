import { TestBed } from '@angular/core/testing';
import { FilEtapesComponent, type EtapeAffichee } from './fil-etapes.component';

const ETAPES: EtapeAffichee[] = [
  { cle: 'a', rang: 1, libelle: 'Premier', renseignee: true },
  { cle: 'b', rang: 2, libelle: 'Deuxième', renseignee: true },
  { cle: 'c', rang: 3, libelle: 'Troisième', renseignee: false },
];

let monte: HTMLElement | null = null;

async function rendre(courante: string, compact?: boolean) {
  const f = TestBed.createComponent(FilEtapesComponent);
  f.componentRef.setInput('etapes', ETAPES);
  f.componentRef.setInput('courante', courante);
  if (compact !== undefined) f.componentRef.setInput('compact', compact);
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
    // Le marqueur visuel est purement décoratif (aria-hidden) ; le texte
    // lu par un lecteur d'écran est le span caché visuellement (sr-only).
    expect(boutons[0].textContent).toContain('(renseignée)');
    expect(boutons[1].textContent).not.toContain('(renseignée)');
    expect(boutons[2].textContent).not.toContain('(renseignée)');
  });

  it('par défaut (module risque, catalogue) : rien ne change — ni nowrap, ni libellé masquable, ni infobulle', async () => {
    const { el } = await rendre('b');
    const boutons = [...el.querySelectorAll('button')];
    expect(boutons.every((b) => !b.classList.contains('whitespace-nowrap') && b.classList.contains('px-2.5'))).toBe(true);
    expect(boutons.every((b) => !b.hasAttribute('title'))).toBe(true);
    expect(el.querySelector('[data-libelle-etape]')!.className).toBe('');
  });

  it('compact (barre du parcours de la carte, 8 étapes) : une ligne par étape ; les libellés des étapes NON courantes se replient en numéro quand la barre est étroite, lus quand même et en infobulle', async () => {
    const { el } = await rendre('b', true);
    const boutons = [...el.querySelectorAll('button')];
    expect(boutons.every((b) => b.classList.contains('whitespace-nowrap') && b.classList.contains('shrink-0') && b.classList.contains('px-1.5'))).toBe(true);
    const libelles = [...el.querySelectorAll('[data-libelle-etape]')];
    // Requête de CONTENEUR (`@container` posé par la barre) : la largeur de la barre décide, pas celle de la fenêtre.
    expect(libelles.map((l) => l.classList.contains('@max-[640px]:sr-only'))).toEqual([true, false, true]);
    // Le texte reste dans le bouton (lecteur d'écran, tests) ; l'infobulle le redit à la souris.
    expect(boutons.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['1 Premier (renseignée)', '2 Deuxième', '3 Troisième']);
    expect(boutons.map((b) => b.getAttribute('title'))).toEqual(['Premier', null, 'Troisième']);
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

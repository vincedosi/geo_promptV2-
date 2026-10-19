import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NotificationsService } from '../../../ui/notifications/notifications.service';
import { JournalComponent, type LigneJournal } from './journal.component';

@Component({
  imports: [JournalComponent],
  providers: [NotificationsService],
  template: '<mg-journal [lignes]="lignes()" [filtrable]="filtrable()" [copiable]="copiable()" [hauteur]="300" />',
})
class Hote {
  readonly lignes = signal<readonly LigneJournal[]>([]);
  readonly filtrable = signal(false);
  readonly copiable = signal(false);
  readonly notifications = inject(NotificationsService);
}

function ligne(i: number, niveau: LigneJournal['niveau'] = 'info'): LigneJournal {
  return { message: `ligne ${i}`, niveau };
}

/**
 * jsdom ne calcule aucune mise en page : `scrollHeight` et `clientHeight` valent 0, donc
 * `scrollTop === scrollHeight` serait vrai même SANS défilement. On pose des valeurs simulées
 * sur l'élément : 20 px par ligne, fenêtre de 300 px.
 */
function simulerMiseEnPage(conteneur: HTMLElement): void {
  let haut = 0;
  Object.defineProperty(conteneur, 'clientHeight', { configurable: true, get: () => 300 });
  Object.defineProperty(conteneur, 'scrollHeight', { configurable: true, get: () => conteneur.children.length * 20 });
  Object.defineProperty(conteneur, 'scrollTop', {
    configurable: true,
    get: () => haut,
    set: (v: number) => { haut = Math.max(0, Math.min(v, conteneur.children.length * 20 - 300)); },
  });
}

async function monter() {
  const f = TestBed.createComponent(Hote);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const conteneur = el.querySelector('[data-terminal]') as HTMLElement;
  simulerMiseEnPage(conteneur);
  return { f, h: f.componentInstance, el, conteneur };
}

describe('JournalComponent', () => {
  it('défile jusqu’en bas à chaque nouvelle ligne par scrollTop, jamais scrollIntoView', async () => {
    const espion = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: espion, configurable: true, writable: true });
    const { f, h, conteneur } = await monter();
    expect(conteneur.style.height).toBe('300px');
    h.lignes.set(Array.from({ length: 500 }, (_, i) => ligne(i)));
    await f.whenStable();
    expect(conteneur.scrollHeight).toBe(10000);
    expect(conteneur.scrollTop).toBe(conteneur.scrollHeight - conteneur.clientHeight);
    expect(espion).not.toHaveBeenCalled();
  });

  it('ne redescend plus si l’utilisateur a remonté (radio/page.tsx:233)', async () => {
    const { f, h, conteneur } = await monter();
    h.lignes.set(Array.from({ length: 100 }, (_, i) => ligne(i)));
    await f.whenStable();
    conteneur.scrollTop = 100;
    conteneur.dispatchEvent(new Event('scroll'));
    h.lignes.set(Array.from({ length: 150 }, (_, i) => ligne(i)));
    await f.whenStable();
    expect(conteneur.scrollTop).toBe(100);
    // Revenu en bas : le suivi reprend.
    conteneur.scrollTop = 150 * 20 - 300;
    conteneur.dispatchEvent(new Event('scroll'));
    h.lignes.set(Array.from({ length: 200 }, (_, i) => ligne(i)));
    await f.whenStable();
    expect(conteneur.scrollTop).toBe(200 * 20 - 300);
  });

  it('filtrable : compteurs exacts par niveau, et filtre sur error seul', async () => {
    const { f, h, el } = await monter();
    h.filtrable.set(true);
    h.lignes.set([ligne(1, 'info'), ligne(2, 'error'), ligne(3, 'warn'), ligne(4, 'error'), ligne(5, 'success'), ligne(6, 'debug')]);
    await f.whenStable();
    const boutons = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-niveau]'));
    expect(boutons.map((b) => b.textContent!.trim())).toEqual(['INFO (1)', 'WARN (1)', 'ERROR (2)', 'SUCCESS (1)', 'DEBUG (1)']);
    // React démarre avec info, warn, error, success actifs — debug masqué.
    expect(el.querySelectorAll('[data-terminal] > div')).toHaveLength(5);
    for (const b of boutons) if (b.dataset['niveau'] !== 'error' && b.getAttribute('aria-pressed') === 'true') b.click();
    await f.whenStable();
    const visibles = Array.from(el.querySelectorAll('[data-terminal] > div')).map((d) => d.textContent!.trim());
    expect(visibles).toEqual(['ligne 2', 'ligne 4']);
  });

  it('copiable : « Copier » joint TOUTES les lignes par \\n et annonce « Logs copiés »', async () => {
    const ecrire = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrire }, configurable: true });
    const { f, h, el } = await monter();
    h.copiable.set(true);
    h.filtrable.set(true);
    h.lignes.set([ligne(1, 'info'), ligne(2, 'debug'), ligne(3, 'error')]);
    await f.whenStable();
    (el.querySelector('[data-copier]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(ecrire).toHaveBeenCalledWith('ligne 1\nligne 2\nligne 3');
    expect(h.notifications.notifications().map((n) => n.titre)).toEqual(['Logs copiés']);
  });

  it('copie impossible (presse-papiers absent ou refusé) : notification d’erreur, jamais d’exception', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const { f, h, el } = await monter();
    h.copiable.set(true);
    h.lignes.set([ligne(1)]);
    await f.whenStable();
    expect(() => (el.querySelector('[data-copier]') as HTMLButtonElement).click()).not.toThrow();
    await Promise.resolve();
    expect(h.notifications.notifications()[0].variante).toBe('error');

    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('refus')) }, configurable: true });
    (el.querySelector('[data-copier]') as HTMLButtonElement).click();
    await Promise.resolve(); await Promise.resolve();
    expect(h.notifications.notifications().filter((n) => n.variante === 'error')).toHaveLength(2);
  });

  it('sans filtrable ni copiable : aucune barre d’outils', async () => {
    const { f, h, el } = await monter();
    h.lignes.set([ligne(1)]);
    await f.whenStable();
    expect(el.querySelector('[data-niveau]')).toBeNull();
    expect(el.querySelector('[data-copier]')).toBeNull();
  });

  it('outils projetés (`[outils]`) : rendus APRÈS « Copier », dans la même rangée (« Fermer » de la radio, `page.tsx:489-497`)', async () => {
    const f = TestBed.createComponent(HoteOutils);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    const rangee = el.querySelector('[data-copier]')!.parentElement!;
    expect([...rangee.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Copier', 'Fermer']);
  });

  it('niveau `rapport` (import Shapefile, T14) : couleur --info, jamais masqué par le filtre', async () => {
    const { f, h, el } = await monter();
    h.filtrable.set(true);
    h.lignes.set([ligne(1, 'rapport'), ligne(2, 'debug')]);
    await f.whenStable();
    const lignes = [...el.querySelectorAll('[data-terminal] > div')] as HTMLElement[];
    expect(lignes.map((l) => l.textContent)).toEqual(['ligne 1']);
    expect(lignes[0].style.color).toBe('var(--info)');
    expect([...el.querySelectorAll('button[data-niveau]')].map((b) => b.getAttribute('data-niveau')))
      .toEqual(['info', 'warn', 'error', 'success', 'debug']);
  });
});

@Component({
  imports: [JournalComponent],
  providers: [NotificationsService],
  template: '<mg-journal [lignes]="[]" [copiable]="true"><button outils type="button">Fermer</button></mg-journal>',
})
class HoteOutils {}

import { TestBed } from '@angular/core/testing';
import { REGISTRE } from '../../testing/jeu-factice';
import { ChoixMailleComponent } from './choix-maille.component';

function monter(plateforme: string, maille: string | null) {
  const f = TestBed.createComponent(ChoixMailleComponent);
  f.componentRef.setInput('lignes', REGISTRE.filter((l) => l.plateforme === plateforme));
  f.componentRef.setInput('maille', maille);
  const choisies: string[] = [];
  f.componentInstance.choisie.subscribe((m) => choisies.push(m));
  f.detectChanges();
  return { el: f.nativeElement as HTMLElement, choisies };
}

describe('mg-choix-maille', () => {
  it('une pastille par ligne du registre, natives d’abord ; la choisie est pressée ; cliquer une autre l’émet', () => {
    const { el, choisies } = monter('dv360', 'cp');
    const boutons = [...el.querySelectorAll<HTMLButtonElement>('button[data-maille]')];
    expect(boutons.map((b) => b.getAttribute('data-maille'))).toEqual(['cp', 'cercle', 'polygone']);
    expect(boutons[0].getAttribute('aria-pressed')).toBe('true');
    boutons[1].click();
    boutons[0].click();
    expect(choisies).toEqual(['cercle']);
  });
  it('`disponible = false` : grisée, NON cliquable, sa raison en infobulle et en texte sous le bouton', () => {
    const { el, choisies } = monter('tiktok', 'departement');
    const cercle = el.querySelector<HTMLButtonElement>('button[data-maille="cercle"]')!;
    expect(cercle.disabled).toBe(true);
    expect(cercle.title).toBe('Aucun ciblage par rayon.');
    cercle.click();
    expect(choisies).toEqual([]);
    expect(el.querySelector('[data-raison]')?.textContent?.trim()).toBe('Aucun ciblage par rayon.');
    expect(el.querySelector<HTMLButtonElement>('button[data-maille="departement"]')!.title).toBe('');
  });
});

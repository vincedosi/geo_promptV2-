import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SitesRisqueApi } from '../risques/data/sites-risque.api';
import { AccueilPage } from './accueil.page';

const SESSION = {
  expires_at: Date.UTC(2026, 9, 3, 12) / 1000,
  user: { email: 'admin@exemple.fr', email_confirmed_at: '2026-01-01', user_metadata: { full_name: 'Alice Martin' } },
};

async function rendre(api: Partial<SitesRisqueApi>, profil: { role: string | null; nom: string | null } | null = null) {
  TestBed.configureTestingModule({
    imports: [AccueilPage],
    providers: [
      provideRouter([{ path: 'carte', children: [{ path: 'risques', children: [] }] }]),
      { provide: SitesRisqueApi, useValue: api },
      { provide: AuthService, useValue: { session: signal(SESSION), lireProfil: () => Promise.resolve(profil) } },
    ],
  });
  const f = TestBed.createComponent(AccueilPage);
  await f.whenStable();
  return f.nativeElement as HTMLElement;
}

describe('AccueilPage', () => {
  it('affiche le nombre de sites, formaté en français', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1259, total: 99152, par_nature: {} }) });
    expect(el.textContent?.replace(/\s/g, ' ')).toContain('1 259');
  });

  it('la tuile des sites à risque mène au module risque : lien RELATIF `carte/risques`, tuile cliquable', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1259, total: 99152, par_nature: {} }) });
    const tuile = Array.from(el.querySelectorAll('mg-tuile-chiffre')).find((t) => t.textContent?.includes('Sites à risque'))!;
    const lien = tuile.closest('a');
    expect(lien?.getAttribute('href')).toBe('/carte/risques');
    expect(lien?.hasAttribute('aria-disabled')).toBe(false);
    expect(tuile.className).toContain('cursor-pointer');
  });

  it("affiche le message de l'erreur, jamais un chargement sans fin", async () => {
    const el = await rendre({
      compter: () => throwError(() => new HttpErrorResponse({ status: 504 })),
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/API ne répond pas/);
  });

  it('porte l\'en-tête et les quatre cartes de session du tableau de bord', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1, total: 2, par_nature: {} }) }, { role: 'super_admin', nom: 'Alice Martin' });
    expect(el.querySelector('h1')?.textContent).toBe('Dashboard');
    expect(el.textContent).toContain('Bienvenue, Alice Martin');
    const textes = Array.from(el.querySelectorAll('mg-tuile-chiffre')).map((t) => t.textContent ?? '');
    expect(textes.some((t) => t.includes('geo.prompt') && t.includes('Copilote IA'))).toBe(true);
    expect(textes.some((t) => t.includes('super_admin') && t.includes('Compte vérifié'))).toBe(true);
    expect(textes.some((t) => t.includes('Expiration session'))).toBe(true);
  });

  it('rend cinq cartes de navigation inertes, avec leur infobulle, et « Accès » active vers admin/acces', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1, total: 2, par_nature: {} }) });
    const liens = el.querySelectorAll('a[aria-disabled="true"]');
    expect(liens.length).toBe(5);
    const acces = Array.from(el.querySelectorAll('a')).find((a) => a.textContent?.includes('Accès'))!;
    expect(acces.hasAttribute('aria-disabled')).toBe(false);
    expect(acces.getAttribute('href')).toMatch(/\/admin\/acces$/);
    expect(el.textContent).not.toContain('Organisations');
    expect(liens[0].getAttribute('title')).toBe('Disponible prochainement');
    expect(el.textContent).toContain('Navigation rapide');
  });

  it('« geo.prompt » suit le patron inerte de la barre latérale', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1, total: 2, par_nature: {} }) });
    const tuile = Array.from(el.querySelectorAll('mg-tuile-chiffre')).find((t) => t.textContent?.includes('geo.prompt'))!;
    expect(tuile.getAttribute('role')).toBe('link');
    expect(tuile.getAttribute('aria-disabled')).toBe('true');
    expect(tuile.getAttribute('tabindex')).toBe('0');
    expect(tuile.getAttribute('title')).toBe('Disponible prochainement');
    expect(tuile.className).toContain('cursor-default');
    expect(tuile.className).not.toContain('cursor-pointer');
    const autre = Array.from(el.querySelectorAll('mg-tuile-chiffre')).find((t) => t.textContent?.includes('Expiration'))!;
    expect(autre.getAttribute('role')).toBeNull();
  });

  it('un profil lu aux champs nuls écrase le jeton, comme { ...user, ...enrich } de React', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1, total: 2, par_nature: {} }) }, { role: null, nom: null });
    expect(el.textContent).toContain('Bienvenue, admin');
    const textes = Array.from(el.querySelectorAll('mg-tuile-chiffre')).map((t) => t.textContent ?? '');
    expect(textes.some((t) => t.includes('Compte vérifié') && t.includes('user'))).toBe(true);
  });

  it('sans profil lu, le nom et le rôle du jeton servent', async () => {
    const el = await rendre({ compter: () => of({ retenus: 1, total: 2, par_nature: {} }) }, null);
    expect(el.textContent).toContain('Bienvenue, Alice Martin');
  });
});

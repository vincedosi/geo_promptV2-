import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lienPageAcces } from '@/lib/espaces/lien-page-acces';

/**
 * Le lien vers la page Angular « Accès » (10/10).
 *
 * Les pages React des droits (`/admin/users`, `/admin/organizations`) sont
 * supprimées : la barre latérale, les Réglages de la carte et la page Sources
 * renvoient vers la page Angular, qui tourne À PART (autonome sur :4200 ou dans
 * le shell AIDA). Son adresse vient donc de l'environnement, jamais d'un
 * littéral — et sans elle, AUCUN lien plutôt qu'un lien mort.
 */
describe('lienPageAcces', () => {
  it('compose l adresse de la page Accès à partir de la base Angular', () => {
    expect(lienPageAcces('http://localhost:4200/app')).toBe('http://localhost:4200/app/admin/acces');
  });

  it('ne double pas la barre oblique finale de la base', () => {
    expect(lienPageAcces('http://localhost:4200/app/')).toBe('http://localhost:4200/app/admin/acces');
    expect(lienPageAcces('  http://hote/app//  ')).toBe('http://hote/app/admin/acces');
  });

  it('rend null sans base : pas de lien mort', () => {
    expect(lienPageAcces(undefined)).toBeNull();
    expect(lienPageAcces('')).toBeNull();
    expect(lienPageAcces('   ')).toBeNull();
  });

  it('rend null si la base n est pas une adresse http(s) : pas de lien relatif ni de schéma exotique', () => {
    expect(lienPageAcces('localhost:4200/app')).toBeNull();
    expect(lienPageAcces('/app')).toBeNull();
    expect(lienPageAcces('javascript:alert(1)')).toBeNull();
    expect(lienPageAcces('ftp://exemple.test/app')).toBeNull();
    expect(lienPageAcces('HTTPS://exemple.test/app')).toBe('HTTPS://exemple.test/app/admin/acces');
  });
});

describe('pages React des droits retirées', () => {
  const RACINE = process.cwd();

  it('les pages /admin/users et /admin/organizations n existent plus', () => {
    for (const page of [
      'app/admin/users/page.tsx',
      'app/admin/organizations/page.tsx',
      'app/admin/organizations/[id]/page.tsx',
      'components/admin/BandeauEspaces.tsx',
    ]) {
      expect(existsSync(join(RACINE, page)), `${page} est réapparu : la page Accès (Angular) le remplace`).toBe(false);
    }
  });

  it('aucun lien de navigation ne vise plus les pages retirées', () => {
    const fichiers = [
      'components/AppSidebar.tsx',
      'components/map/overlays/SettingsOverlay.tsx',
      'app/dashboard/page.tsx',
      'app/admin/sources/page.tsx',
    ];
    for (const f of fichiers) {
      const src = readFileSync(join(RACINE, f), 'utf-8');
      expect(src, f).not.toMatch(/href:\s*'\/admin\/(users|organizations)'/);
      expect(src, f).toContain('lienPageAcces');
    }
  });

  it('la variable NEXT_PUBLIC_URL_ANGULAR est déclarée et documentée', () => {
    expect(readFileSync(join(RACINE, '.env.example'), 'utf-8')).toMatch(/^NEXT_PUBLIC_URL_ANGULAR=/m);
    expect(readFileSync(join(RACINE, 'ARCHITECTURE.md'), 'utf-8')).toContain('NEXT_PUBLIC_URL_ANGULAR');
  });
});

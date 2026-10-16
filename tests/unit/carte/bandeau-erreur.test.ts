import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BandeauErreur } from '@/components/map/BandeauErreur';

/**
 * @file tests/unit/carte/bandeau-erreur.test.ts — les erreurs de /map
 * s'affichent de nouveau (lot 5, round de correction 1).
 *
 * `ChatPanel` était le seul à rendre l'état `error` de `app/map/page.tsx`,
 * alimenté par `useMapDirectActions` et `useVoronoiDirect`. Son retrait a rendu
 * muets le refus de périmètre du Voronoï, les délais dépassés, les erreurs OOH…
 */
describe('BandeauErreur', () => {
  it('rend le message dans une alerte aux jetons de danger', () => {
    const html = renderToStaticMarkup(
      createElement(BandeauErreur, { message: 'Voronoï — Erreur : refusé', onFermer: () => {} }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Voronoï — Erreur : refusé');
    expect(html).toContain('var(--danger)');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('ne rend rien sans message', () => {
    expect(renderToStaticMarkup(createElement(BandeauErreur, { message: null, onFermer: () => {} }))).toBe('');
  });

  it('offre une croix de fermeture nommée', () => {
    const html = renderToStaticMarkup(
      createElement(BandeauErreur, { message: 'x', onFermer: () => {} }),
    );
    // React échappe l'apostrophe en &#x27; dans le HTML rendu.
    expect(html).toMatch(/aria-label="Fermer le message d(&#x27;|')erreur"/);
  });

  it('est câblé dans app/map/page.tsx sur l\'état error', () => {
    const src = readFileSync(join(process.cwd(), 'app/map/page.tsx'), 'utf8');
    expect(src).toMatch(/<BandeauErreur\s+message=\{error\}\s+onFermer=\{\(\) => setError\(null\)\}/);
  });
});

import { describe, it, expect } from 'vitest';
import { echapperHtml } from '@/lib/map/echapper-html';

describe('echapperHtml', () => {
  it('rend inerte une charge active classique', () => {
    const charge = '<img src=x onerror=alert(1)>';
    const sortie = echapperHtml(charge);
    expect(sortie).not.toContain('<');
    expect(sortie).not.toContain('>');
    expect(sortie).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it("echappe l'apostrophe — sortie possible d'un attribut en quotes simples", () => {
    // C'est le caractere que l'ancienne version locale de useMapMarkers omettait.
    expect(echapperHtml("' onmouseover='alert(1)")).toBe('&#39; onmouseover=&#39;alert(1)');
  });

  it('echappe le guillemet double — sortie d\'un attribut en quotes doubles', () => {
    expect(echapperHtml('" onload="x')).toBe('&quot; onload=&quot;x');
  });

  it("traite l'esperluette en premier, sinon les entites sont re-echappees", () => {
    // Si `<` etait remplace avant `&`, on obtiendrait `&amp;lt;` au lieu de `&lt;`.
    expect(echapperHtml('<')).toBe('&lt;');
    expect(echapperHtml('&lt;')).toBe('&amp;lt;');
  });

  it('laisse passer un texte ordinaire sans le deformer', () => {
    expect(echapperHtml('Saint-Étienne-du-Rouvray')).toBe('Saint-Étienne-du-Rouvray');
    expect(echapperHtml('12 rue de la Paix, 75002')).toBe('12 rue de la Paix, 75002');
  });

  it('rend une chaine vide pour null et undefined, jamais "null"', () => {
    expect(echapperHtml(null)).toBe('');
    expect(echapperHtml(undefined)).toBe('');
  });

  it('accepte les nombres — les popups en interpolent beaucoup', () => {
    expect(echapperHtml(0)).toBe('0');
    expect(echapperHtml(1234.5)).toBe('1234.5');
  });

  it('accepte ce que la frontiere laisse passer, sans jamais rendre "[object Object]" brut', () => {
    // Les proprietes d'une feature arrivent en Record<string, unknown>.
    expect(echapperHtml({ a: 1 })).not.toContain('<');
    expect(echapperHtml(true)).toBe('true');
  });

  it('est idempotent sur une sortie deja echappee au sens ou rien ne s en echappe', () => {
    const deuxFois = echapperHtml(echapperHtml('<script>alert(1)</script>'));
    expect(deuxFois).not.toContain('<');
    expect(deuxFois).not.toContain('>');
  });
});

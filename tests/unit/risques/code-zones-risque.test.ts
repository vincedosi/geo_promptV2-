/**
 * La clé de cache des zones de risque.
 *
 * Elle indexe `zones_risque_cache`, et depuis sql/220 la géométrie dépend du
 * filtre de nature : les anneaux ne sont plus tracés autour des mêmes sites.
 * Une clé qui ignorerait les natures servirait les zones d'un filtre sous la
 * légende d'un autre — le défaut même que l'en-tête de la route de tuiles
 * écarte pour les empreintes de hachage.
 */
import { describe, it, expect } from 'vitest';
import { codeProfil, codeZonesRisque } from '@/lib/risques/code-profil';
import type { ProfilRayons } from '@/lib/risques/profil';

const PROFIL: ProfilRayons = {
  haut: [1000, 2000],
  bas: [500],
  autres: [],
  lie: false,
  inclurePPRT: true,
};

describe('codeZonesRisque', () => {
  const base = codeProfil(PROFIL);

  it('sans nature, rend le code du profil INCHANGÉ', () => {
    // C'est ce qui rend les caches bâtis avant le filtre encore valides : rien
    // n'est à reconstruire pour les vues qui ne filtrent pas.
    expect(codeZonesRisque(base, [])).toBe(base);
    expect(codeZonesRisque(base)).toBe(base);
  });

  it('distingue deux filtres de nature sur le MÊME profil', () => {
    const a = codeZonesRisque(base, ['Explosibles']);
    const b = codeZonesRisque(base, ['Toxicité aiguë']);
    expect(a).not.toBe(b);
    expect(a).not.toBe(base);
  });

  it('ne dépend pas de l’ORDRE des natures', () => {
    // Deux sélections des mêmes natures posent la même question, et ne doivent
    // pas coûter deux constructions de 1,3 s.
    expect(codeZonesRisque(base, ['Explosibles', 'Déchets']))
      .toBe(codeZonesRisque(base, ['Déchets', 'Explosibles']));
  });

  it('encode les caractères qui casseraient une URL ou un nom de fichier', () => {
    // « Chimie (IED) » porte des parenthèses, qu'`encodeURIComponent` laisse
    // passer — d'où l'encodage strict partagé avec `codeJeu`.
    const c = codeZonesRisque(base, ['Chimie (IED)']);
    expect(c).not.toContain('(');
    expect(c).not.toContain(')');
    expect(c).not.toContain(' ');
  });

  it('reste préfixé par le code du profil, donc lisible à l’œil', () => {
    // Devant une tuile qui n'affiche pas ce qu'on attend, la clé doit se LIRE.
    expect(codeZonesRisque(base, ['Explosibles']).startsWith(base)).toBe(true);
  });
});

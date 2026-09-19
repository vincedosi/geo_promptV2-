import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Verrous STRUCTURELS sur les gardes d'I/O des routes « zone à risque ».
 *
 * Ils lisent le SOURCE plutôt que de simuler le comportement, comme
 * `tests/unit/carte/panneau-analyse-garde.test.ts` : une première version de ce
 * projet avait écrit une garde correctement dans un test isolé tout en laissant
 * la vraie route sans garde en production. Seul un test qui lit le fichier réel
 * attrape cet écart-là.
 *
 * Les deux défauts gardés ici sont les constats R-01 et R-02 de
 * `docs/AUDIT_ZONE_RISQUE.md`, et ils avaient le même visage : **une intention
 * écrite en commentaire que rien n'appliquait**.
 */

const RACINE = process.cwd();
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf-8');

/** Les sept routes du périmètre, avec le quota attendu (null = pas de quota). */
const ROUTES: ReadonlyArray<readonly [string, string | null]> = [
  ['app/api/risques/exposition/agregats/route.ts', 'geo:rl:exposition-agregats'],
  ['app/api/risques/exposition/export/route.ts', 'geo:rl:exposition-export'],
  ['app/api/risques/exposition/rayon/route.ts', 'geo:rl:exposition-rayon'],
  ['app/api/risques/[siteId]/exposition/route.ts', 'geo:rl:exposition-site'],
  // Catalogue borné (24 lignes), cache privé 24 h : pas de quota, à dessein.
  ['app/api/risques/exposition/cibles/route.ts', null],
  // Lectures bornées par bbox, cache CDN : pas de quota, à dessein.
  ['app/api/map/risques-industriels/route.ts', null],
  ['app/api/map/pprt/route.ts', null],
];

describe('gardes d’authentification', () => {
  it('les sept routes du périmètre exigent une session', () => {
    // Aucune n'est dans `PROTECTED_API_PREFIXES` du middleware : le
    // `requireAuth` en tête de handler est la SEULE protection.
    for (const [chemin] of ROUTES) {
      const s = lire(chemin);
      expect(s, `${chemin} : requireAuth manquant`).toMatch(/await requireAuth\(request\)/);
      expect(s, `${chemin} : le refus n'est pas rendu`).toMatch(/return authUnauthorized\(\)/);
    }
  });
});

describe('quotas d’appels', () => {
  it('chaque route qui calcule porte son quota, et le bon', () => {
    for (const [chemin, prefixe] of ROUTES) {
      const s = lire(chemin);
      if (prefixe === null) {
        expect(s, `${chemin} ne devrait pas porter de quota`).not.toMatch(/createRateLimiter/);
        continue;
      }
      expect(s, `${chemin} : quota absent`).toMatch(/createRateLimiter\(/);
      expect(s, `${chemin} : mauvais préfixe`).toContain(prefixe);
      expect(s, `${chemin} : le refus n'est pas rendu`).toMatch(/rateLimitResponse\(quota\.retrySec\)/);
    }
  });

  it('le quota de `[siteId]/exposition` est consommé AVANT toute lecture', () => {
    // R-01. C'est la seule des quatre routes qui CALCULE et ÉCRIT : ~300 ms
    // d'intersection sur 2,3 M carreaux, puis un `upsert`. `siteId` étant
    // énumérable sur 99 152 sites, une boucle réalisait le « pré-calcul de
    // masse » que l'en-tête du fichier déclare refuser.
    //
    // Un appel refusé ne doit rien coûter à la base : le quota vient donc avant
    // `createAdminClient`, sans quoi le garde-fou paierait le prix qu'il évite.
    const s = lire('app/api/risques/[siteId]/exposition/route.ts');
    const posQuota = s.indexOf('await limiteur(profile.id)');
    const posClient = s.indexOf('createAdminClient()');
    expect(posQuota, 'le quota doit être appelé').toBeGreaterThan(-1);
    expect(posClient, 'la route doit ouvrir un client').toBeGreaterThan(-1);
    expect(posQuota, 'le quota doit précéder le client Supabase').toBeLessThan(posClient);
  });
});

describe('bbox absente — la règle est APPLIQUÉE, pas seulement annoncée', () => {
  const s = lire('app/api/map/risques-industriels/route.ts');

  it('refuse les régimes non-Seveso quand aucune emprise n’est fournie', () => {
    // R-02. Le commentaire du schéma annonçait « réservé aux Seveso » et rien
    // ne l'appliquait : `?gravites=autre&limite=5000&rayon_m=20000` sans bbox
    // balayait 41 690 sites et sérialisait 5 000 `ST_Buffer` de 20 km.
    expect(s).toMatch(/const bbox = bboxValide\(p\.bbox\)/);
    expect(s).toMatch(/if \(!bbox && gravites\.some\(/);
    expect(s).toMatch(/status: 400/);
  });

  it('refuse explicitement au lieu de rogner en silence', () => {
    // Rogner la demande rendrait une carte incomplète présentée comme
    // complète — pire qu'un refus, parce qu'invisible.
    expect(s).toMatch(/Sans emprise géographique/);
    expect(s).toMatch(/Ajoutez une bbox/);
  });

  it('la bbox validée n’est calculée qu’UNE fois', () => {
    // Deux appels à `bboxValide` laisseraient la garde et la requête juger sur
    // deux résultats potentiellement différents.
    expect(s.match(/bboxValide\(p\.bbox\)/g)?.length ?? 0).toBe(1);
    expect(s).toMatch(/p_bbox: nullableArg\(bbox\)/);
  });
});

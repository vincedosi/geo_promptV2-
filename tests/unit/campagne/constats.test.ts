import { describe, it, expect } from 'vitest'
import { calculerConstats } from '@/lib/campagne/constats'

describe('constats de correction', () => {
  it('n affiche rien quand tout va bien', () => {
    expect(calculerConstats({
      unites: [{ code: '75', nom: 'Paris', ecart_pct: 2, impressions: 1000, cpm: 6.5 }],
      cpm_moyen: 6.5, canaux: [{ code: 'dv360', cpm: 6.4 }],
    })).toEqual([])
  })

  it('nomme les départements qui concentrent la sous-pression', () => {
    const c = calculerConstats({
      unites: [
        { code: '13', nom: 'Bouches-du-Rhône', ecart_pct: -52, impressions: 400, cpm: 6.5 },
        { code: '59', nom: 'Nord', ecart_pct: -48, impressions: 420, cpm: 6.5 },
        { code: '75', nom: 'Paris', ecart_pct: 1, impressions: 5000, cpm: 6.5 },
      ],
      cpm_moyen: 6.5, canaux: [],
    })
    expect(c[0].titre).toContain('13')
    expect(c[0].titre).toContain('59')
  })

  it('signale un canal nettement plus cher que la moyenne', () => {
    const c = calculerConstats({
      unites: [], cpm_moyen: 6.5,
      canaux: [{ code: 'tiktok', cpm: 9.2 }, { code: 'dv360', cpm: 6.1 }],
    })
    expect(c.some(x => x.titre.includes('tiktok') && x.titre.includes('41'))).toBe(true)
  })

  /**
   * Le titre précédent — « rend au plus trois constats, LES PLUS LOURDS
   * D'ABORD » — promettait un tri que `calculerConstats` ne fait pas et n'a
   * jamais prétendu faire : les trois familles sont évaluées dans un ORDRE
   * FIXE (sous-pression, sur-pression, canal cher), et son en-tête explique
   * pourquoi (impressions manquantes, euros déplaçables et écart de CPM ne
   * sont pas sur la même échelle, les comparer entre elles ne voudrait rien
   * dire). L'unique assertion était `length <= 3` — vraie par construction,
   * puisque chaque famille produit au plus un constat : elle ne pouvait rougir
   * sur aucun défaut.
   *
   * Ce que ce test vérifie maintenant : l'ordre RÉEL et son identité, donc un
   * réordonnancement des familles (ou une famille qui en produirait deux)
   * ferait rougir.
   */
  it('rend les trois familles dans un ordre FIXE, une seule fois chacune', () => {
    const c = calculerConstats({
      unites: Array.from({ length: 20 }, (_, i) => ({
        code: String(i), nom: `d${i}`, ecart_pct: -60, impressions: 100, cpm: 6.5,
      })),
      cpm_moyen: 6.5, canaux: [{ code: 'tiktok', cpm: 12 }],
    })
    expect(c.map((x) => x.id)).toEqual(['sous_pression', 'canal_cher'])
  })

  /**
   * À L'INTÉRIEUR d'une famille, en revanche, « les plus lourds d'abord » est
   * une vraie promesse : `constatSousPression` trie par volume manquant ESTIMÉ
   * décroissant et ne nomme que les deux premiers. Le test « nomme les
   * départements qui concentrent la sous-pression » ci-dessus ne vérifiait que
   * la présence de deux codes, jamais leur ordre ni le choix des deux.
   *
   * Ce jeu de quatre départements donne trois classements DIFFÉRENTS selon le
   * comparateur, tous calculés à la main (`plan = imps / (1 + écart/100)`) :
   *
   *   code  écart   imps    plan estimé   manque
   *   A     -90 %    100       1 000,00      900,00
   *   B     -30 %  7 000      10 000,00    3 000,00
   *   C     -60 %    800       2 000,00    1 200,00
   *   D     -21 %  9 000      11 392,41    2 392,41
   *
   *   par manque (attendu) : B D C A    → nommés « B et D », cible B
   *   par impressions      : D B C A    → nommerait « D et B », cible D
   *   par écart le plus bas: A C B D    → nommerait « A et C », cible A
   *
   * Total annoncé : round(3 000 + 2 392,41) = 5 392.
   */
  it('nomme les deux plus GROS volumes manquants, pas les plus gros écarts ni les plus gros volumes', () => {
    const c = calculerConstats({
      unites: [
        { code: 'A', nom: 'Aube', ecart_pct: -90, impressions: 100, cpm: 6.5 },
        { code: 'B', nom: 'Bouches-du-Rhône', ecart_pct: -30, impressions: 7000, cpm: 6.5 },
        { code: 'C', nom: 'Cantal', ecart_pct: -60, impressions: 800, cpm: 6.5 },
        { code: 'D', nom: 'Dordogne', ecart_pct: -21, impressions: 9000, cpm: 6.5 },
      ],
      cpm_moyen: 6.5, canaux: [],
    })
    const sous = c.find((x) => x.id === 'sous_pression')!
    expect(sous.cible).toBe('B')
    expect(sous.titre.indexOf('(B)')).toBeGreaterThanOrEqual(0)
    expect(sous.titre.indexOf('(D)')).toBeGreaterThan(sous.titre.indexOf('(B)'))
    expect(sous.titre).not.toContain('(A)')
    expect(sous.titre).not.toContain('(C)')
    // Espaces normalisés : `toLocaleString('fr-FR')` sépare les milliers par
    // une espace fine insécable (U+202F), pas par une espace ordinaire.
    expect(sous.titre.replace(/[\s\u202f\u00a0]/g, '')).toContain('5392impressionsmanquantes')
  })

  // Ruling T11-2 : une unité hors plan (ecart_pct null, plan nul) est la
  // sur-pression la plus pure — tout son volume est en trop. Avant ce
  // ruling, le filtre sur ecart_pct l'excluait en silence.
  it('compte la totalité du volume hors plan comme de la sur-pression', () => {
    const c = calculerConstats({
      unites: [
        { code: '06', nom: 'Alpes-Maritimes', ecart_pct: null, impressions: 500, cpm: 7, hors_plan: true, volume_deplace: 500 },
      ],
      cpm_moyen: 6.5, canaux: [],
    })
    expect(c.some((x) => x.id === 'sur_pression' && x.titre.includes('06'))).toBe(true)
  })

  // ── Le tri et la mesure affichee sont la MEME grandeur ────────────────────
  // `constatSurPression` classait par volume (`trop`) puis titrait en euros :
  // une unite au `cpm` nul gagnait le classement avec `eur: 0`, et le constat
  // annoncait « X et Y concentrent la sur-pression : 0 € deplacables », une
  // phrase qui se contredit elle-meme.
  it('ne titre jamais « 0 € deplacables » — sans depense connue, il chiffre le volume', () => {
    const c = calculerConstats({
      unites: [
        { code: '06', nom: 'Alpes-Maritimes', ecart_pct: null, impressions: 900, cpm: null, hors_plan: true, volume_deplace: 900 },
        { code: '2A', nom: 'Corse-du-Sud', ecart_pct: null, impressions: 300, cpm: null, hors_plan: true, volume_deplace: 300 },
      ],
      cpm_moyen: null, canaux: [],
    })
    const sur = c.find((x) => x.id === 'sur_pression')
    expect(sur).toBeDefined()
    expect(sur!.titre).not.toContain('0 €')
    expect(sur!.titre).toContain('impressions')
  })

  it('classe par euros quand la depense est connue, pas par volume seul', () => {
    // '2B' a MOINS de volume mais un CPM 10x superieur : c'est lui qui porte
    // les euros deplacables, donc lui qui doit mener le constat.
    const c = calculerConstats({
      unites: [
        { code: '06', nom: 'Alpes-Maritimes', ecart_pct: null, impressions: 1000, cpm: 1, hors_plan: true, volume_deplace: 1000 },
        { code: '2B', nom: 'Haute-Corse', ecart_pct: null, impressions: 800, cpm: 40, hors_plan: true, volume_deplace: 800 },
      ],
      cpm_moyen: null, canaux: [],
    })
    const sur = c.find((x) => x.id === 'sur_pression')
    expect(sur!.cible).toBe('2B')
    expect(sur!.titre).toContain('€')
  })
})

/**
 * Cache mémoire de tuiles, partagé par les trois routes MVT du projet
 * (carreaux, IRIS, TMJA). Il remplace trois copies du même code, qui avaient
 * toutes le même défaut.
 *
 * ── Ce que les trois copies faisaient de faux ──────────────────────────────
 *
 * 1. **Elles purgeaient par ordre d'INSERTION, pas d'usage.** `Map.keys()`
 *    rend les clés dans l'ordre où elles ont été posées : la purge supprimait
 *    donc les 200 tuiles les plus ANCIENNEMENT INSÉRÉES, sans regarder si
 *    elles venaient d'être servies mille fois. Une tuile très demandée — Paris
 *    à z9 — était évincée avant une tuile vue une seule fois. C'est l'inverse
 *    de ce qu'un cache doit faire.
 *
 * 2. **Elles se bornaient en NOMBRE d'entrées, jamais en octets.** Or une
 *    tuile pèse de 101 ko à 827 ko selon la zone (mesures du 2026-09-12) : un
 *    plafond de 1 000 entrées ne borne donc rien du tout. Au pire cas mesuré,
 *    1 000 tuiles carreaux à 297 ko représentaient **297 Mo de RSS** dans une
 *    fonction serverless qui en a 1 024 au total.
 *
 * Ici le budget est exprimé en OCTETS, seule unité qui borne vraiment la
 * mémoire, et l'éviction retire la tuile la moins RÉCEMMENT LUE.
 *
 * L'astuce d'implémentation : un `Map` JavaScript conserve l'ordre
 * d'insertion, et `delete` puis `set` remet une clé en queue. Lire une entrée
 * la déplace donc en fin de Map, et l'éviction consomme la tête. Pas de
 * structure chaînée à maintenir.
 *
 * Ce cache reste **par instance** : sur Vercel, chaque invocation peut tomber
 * sur une instance différente. Il ne remplace pas le cache CDN (`s-maxage`),
 * il l'assiste sur les salves d'une même instance.
 */

export interface OptionsCacheTuiles {
  /** Budget mémoire total, en octets. C'est la seule borne qui compte. */
  budgetOctets: number;
  /** Durée de validité d'une entrée, en millisecondes. */
  ttlMs: number;
  /**
   * Plafond de sécurité sur le nombre d'entrées. Sert uniquement à borner le
   * coût des métadonnées si un jour des tuiles minuscules affluent ; le budget
   * en octets reste la borne utile.
   */
  maxEntrees?: number;
}

interface Entree {
  buf: Buffer;
  expire: number;
}

export interface CacheTuiles {
  /** Rend la tuile et la marque comme récemment utilisée, ou `null`. */
  lire(cle: string): Buffer | null;
  ecrire(cle: string, buf: Buffer): void;
  /** Pour les tests et une éventuelle sonde de diagnostic. */
  etat(): { entrees: number; octets: number };
  vider(): void;
}

export function creerCacheTuiles({
  budgetOctets,
  ttlMs,
  maxEntrees = 5000,
}: OptionsCacheTuiles): CacheTuiles {
  const entrees = new Map<string, Entree>();
  let octets = 0;

  function retirer(cle: string): void {
    const e = entrees.get(cle);
    if (!e) return;
    octets -= e.buf.byteLength;
    entrees.delete(cle);
  }

  function evincerSiNecessaire(): void {
    // La tête du Map est l'entrée la moins récemment lue ou écrite.
    for (const cle of entrees.keys()) {
      if (octets <= budgetOctets && entrees.size <= maxEntrees) return;
      retirer(cle);
    }
  }

  return {
    lire(cle) {
      const e = entrees.get(cle);
      if (!e) return null;
      if (Date.now() >= e.expire) {
        retirer(cle);
        return null;
      }
      // Remettre en queue : c'est ce qui fait de ce cache un LRU et non un FIFO.
      entrees.delete(cle);
      entrees.set(cle, e);
      return e.buf;
    },

    ecrire(cle, buf) {
      retirer(cle);
      // Une tuile plus grosse que le budget entier n'est pas mise en cache :
      // l'accepter reviendrait à vider le cache pour une seule entrée.
      if (buf.byteLength > budgetOctets) return;
      entrees.set(cle, { buf, expire: Date.now() + ttlMs });
      octets += buf.byteLength;
      evincerSiNecessaire();
    },

    etat: () => ({ entrees: entrees.size, octets }),

    vider() {
      entrees.clear();
      octets = 0;
    },
  };
}

/**
 * Budget par route. La somme des trois tient dans une fraction des 1 024 Mo
 * d'une fonction Vercel, en laissant la place au reste du travail.
 *
 * Les tuiles sont stockées GZIPPÉES (les trois routes le font désormais), donc
 * un budget de 24 Mo représente environ 300 tuiles carreaux typiques, contre
 * les 1 000 entrées non compressées d'avant — pour 12 fois moins de mémoire.
 */
export const BUDGET_CACHE_TUILES_OCTETS = 24 * 1024 * 1024;

/** Une heure : au-delà, le cache CDN prend le relais. */
export const TTL_CACHE_TUILES_MS = 60 * 60 * 1000;

'use client';

/**
 * L'atelier des jeux de zones : bibliothèque, construction, réglage.
 *
 * ── LE COMPROMIS QUE CE HOOK ORGANISE ─────────────────────────────────────
 *
 * Construire un jeu coûte **21,3 s** (7 classes, 1 942 codes postaux) parce
 * qu'il faut affecter chaque carreau INSEE de 200 m à une classe puis mesurer
 * ce que cela couvre de chaque code postal.
 *
 * Rien de tout cela ne dépend du SEUIL de couverture, ni des poids, ni du mode
 * de plan. On construit donc une fois — dans un BROUILLON, avant même qu'un
 * nom soit choisi — et tous les réglages qui suivent se rejouent en 22 ms
 * (`appliquer_seuil_zone_set`, sql/215).
 *
 * ── LA COURSE, ET POURQUOI ELLE MORD ICI ──────────────────────────────────
 *
 * Deux constructions lancées coup sur coup peuvent revenir dans le désordre :
 * la seconde porte souvent sur moins de classes et double la première. L'écran
 * afficherait alors le taux d'utile d'un profil que plus personne ne regarde,
 * sans rien pour le signaler. Chaque appel porte donc un jeton, et seul le
 * dernier a le droit d'écrire — même garde que `use-bandes.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import type { JeuDeZones } from '@/lib/zones/jeu';

/** Une ligne de la bibliothèque. */
export interface JeuResume {
  id: string;
  nom: string;
  description: string | null;
  version: number;
  created_at: string;
  construit_le: string | null;
  population_exposee: number | null;
  n_cp_retenus: number | null;
  taux_utile: number | null;
  mode_plan: string;
  seuil_couverture_cp: number;
}

/** Ce qu'une classe pèse dans un jeu construit. */
export interface ClasseJeu {
  classe: string;
  n_cp: number;
  n_cp_retenus: number;
  population_en_zone: number;
  population_achetee: number;
}

/** Le détail d'un jeu construit, brouillon compris. */
export interface JeuDetail {
  jeu: JeuResume & {
    brouillon: boolean;
    profil: unknown;
    profil_hash: string;
    poids: Record<string, number>;
  };
  classes: ClasseJeu[];
}

/** `'vide' | 'chargement' | 'echec' | 'pret'`, porté À CÔTÉ de la donnée. */
export type EtatAtelier = 'vide' | 'chargement' | 'echec' | 'pret';

interface Atelier {
  /** Les jeux enregistrés de l'organisation. */
  bibliotheque: JeuResume[];
  etatBibliotheque: EtatAtelier;
  /** Le jeu ouvert : brouillon en cours de réglage, ou jeu enregistré. */
  detail: JeuDetail | null;
  etat: EtatAtelier;
  erreur: string | null;
  /** Construit un brouillon pour ce jeu, ou retrouve celui qui existe déjà. */
  construire: (jeu: JeuDeZones) => Promise<void>;
  /** Rejoue le seuil, les poids, le mode de plan, ou enregistre le brouillon. */
  regler: (champs: ReglageJeu) => Promise<boolean>;
  /** Ouvre un jeu déjà enregistré. */
  ouvrir: (id: string) => Promise<void>;
  /** Retire un jeu de la bibliothèque. */
  supprimer: (id: string) => Promise<boolean>;
}

export interface ReglageJeu {
  nom?: string;
  description?: string | null;
  mode_plan?: 'pondere' | 'exclusif';
  seuil_couverture_cp?: number;
  poids?: Record<string, number>;
  enregistrer?: boolean;
}

/** Le message d'une réponse en erreur, sans jamais lever sur un corps illisible. */
async function messageErreur(rep: Response, defaut: string): Promise<string> {
  try {
    const j = await rep.json();
    return typeof j?.error === 'string' ? j.error : defaut;
  } catch {
    return defaut;
  }
}

export function useJeuxZones(): Atelier {
  const [bibliotheque, setBibliotheque] = useState<JeuResume[]>([]);
  const [etatBibliotheque, setEtatBibliotheque] = useState<EtatAtelier>('chargement');
  const [detail, setDetail] = useState<JeuDetail | null>(null);
  const [etat, setEtat] = useState<EtatAtelier>('vide');
  const [erreur, setErreur] = useState<string | null>(null);

  /** Le jeton du dernier appel. Seul lui a le droit d'écrire dans l'état. */
  const jeton = useRef(0);
  /**
   * Reste-t-on monté ? Un écran fermé pendant les 21 s d'une construction ne
   * doit pas écrire dans un état qui n'existe plus.
   *
   * ⚠ **Le drapeau est REMIS À `true` à chaque montage, et ce n'est pas une
   * précaution superflue.** En développement, React monte, démonte puis
   * remonte chaque composant (StrictMode) : sans cette ligne, le nettoyage du
   * premier montage laisse `monte.current` à `false` POUR TOUJOURS, et plus
   * aucune réponse n'est jamais affichée.
   *
   * Constaté le 2026-09-20, et le symptôme ne désigne pas sa cause : le POST
   * répondait 201, la construction était bel et bien faite en base, et l'écran
   * restait sur « Construction des zones… » indéfiniment. Rien dans la console,
   * rien dans le réseau — juste une garde qui refusait tout.
   */
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  const rafraichirBibliotheque = useCallback(async () => {
    setEtatBibliotheque('chargement');
    try {
      const rep = await adminFetch('/api/zones/jeux');
      if (!rep.ok) throw new Error(await messageErreur(rep, 'Bibliothèque indisponible.'));
      const j = await rep.json();
      if (!monte.current) return;
      setBibliotheque(Array.isArray(j.jeux) ? j.jeux : []);
      setEtatBibliotheque('pret');
    } catch {
      if (monte.current) setEtatBibliotheque('echec');
    }
  }, []);

  useEffect(() => { void rafraichirBibliotheque(); }, [rafraichirBibliotheque]);

  const chargerDetail = useCallback(async (id: string, mien: number) => {
    const rep = await adminFetch(`/api/zones/jeux/${id}`);
    if (!rep.ok) throw new Error(await messageErreur(rep, 'Jeu de zones illisible.'));
    const j = (await rep.json()) as JeuDetail;
    // ⚠ Le jeton AVANT l'écriture : une réponse arrivée après une autre plus
    // récente doit être jetée, pas affichée.
    if (!monte.current || mien !== jeton.current) return;
    setDetail({ jeu: j.jeu, classes: j.classes ?? [] });
    setEtat('pret');
  }, []);

  const construire = useCallback(async (jeu: JeuDeZones) => {
    const mien = ++jeton.current;
    setEtat('chargement');
    setErreur(null);
    try {
      const rep = await adminFetch('/api/zones/jeux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeu, brouillon: true }),
      });
      if (!rep.ok) throw new Error(await messageErreur(rep, 'Construction impossible.'));
      const j = await rep.json();
      if (!monte.current || mien !== jeton.current) return;
      await chargerDetail(j.id as string, mien);
    } catch (e) {
      if (!monte.current || mien !== jeton.current) return;
      setErreur((e as Error).message);
      setEtat('echec');
    }
  }, [chargerDetail]);

  const ouvrir = useCallback(async (id: string) => {
    const mien = ++jeton.current;
    setEtat('chargement');
    setErreur(null);
    try {
      await chargerDetail(id, mien);
    } catch (e) {
      if (!monte.current || mien !== jeton.current) return;
      setErreur((e as Error).message);
      setEtat('echec');
    }
  }, [chargerDetail]);

  const regler = useCallback(async (champs: ReglageJeu): Promise<boolean> => {
    const id = detail?.jeu.id;
    if (!id) return false;
    const mien = ++jeton.current;
    setErreur(null);
    try {
      const rep = await adminFetch(`/api/zones/jeux/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(champs),
      });
      if (!rep.ok) throw new Error(await messageErreur(rep, 'Modification impossible.'));
      // Le détail est RELU plutôt que fusionné à la main : le seuil change
      // `retenu` sur chaque code postal, donc le compte et le taux d'utile de
      // CHAQUE classe. Reconstituer cela côté client dupliquerait le calcul du
      // serveur, et les deux finiraient par diverger.
      await chargerDetail(id, mien);
      if (champs.enregistrer) await rafraichirBibliotheque();
      return true;
    } catch (e) {
      if (monte.current && mien === jeton.current) setErreur((e as Error).message);
      return false;
    }
  }, [detail?.jeu.id, chargerDetail, rafraichirBibliotheque]);

  const supprimer = useCallback(async (id: string): Promise<boolean> => {
    setErreur(null);
    try {
      const rep = await adminFetch(`/api/zones/jeux/${id}`, { method: 'DELETE' });
      if (!rep.ok) throw new Error(await messageErreur(rep, 'Suppression impossible.'));
      if (!monte.current) return true;
      // Le jeu ouvert vient peut-être d'être supprimé : le laisser affiché
      // donnerait à régler un objet qui n'existe plus.
      setDetail((d) => (d?.jeu.id === id ? null : d));
      setEtat((e) => (detail?.jeu.id === id ? 'vide' : e));
      await rafraichirBibliotheque();
      return true;
    } catch (e) {
      if (monte.current) setErreur((e as Error).message);
      return false;
    }
  }, [detail?.jeu.id, rafraichirBibliotheque]);

  return {
    bibliotheque, etatBibliotheque, detail, etat, erreur,
    construire, regler, ouvrir, supprimer,
  };
}

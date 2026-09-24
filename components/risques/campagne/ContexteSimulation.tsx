'use client';

/**
 * L'état de l'étape ⑤ Campagne, partagé par ses quatre lecteurs : le panneau,
 * le bandeau de chiffres, la carte et le tableau des zones.
 *
 * ── POURQUOI UN CONTEXTE ──────────────────────────────────────────────────
 *
 * Les quatre vivent dans des branches différentes de l'overlay (le bandeau
 * au-dessus du corps, le panneau à gauche, la carte et le tableau à droite).
 * Chacun chargeant la simulation pour lui ferait quatre appels à une route qui
 * agrège 168 000 lignes — et quatre lectures qui pourraient ne pas voir la même
 * version entre deux recalages.
 *
 * ⚠ Rien ne se charge tant que l'étape ⑤ n'a pas été ouverte : les étapes ①
 * à ④ ne doivent pas payer une simulation qu'elles n'affichent pas.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { construireVue, courbeAlignement, type Periode, type VueSimulation, type PointCourbe } from '@/lib/simulation/vue';
import type { EvenementSimulation, ReponseSimulation } from '@/lib/simulation/payload';
import { usePiste } from '@/components/risques/ContexteChargement';

export interface Progression {
  message: string;
  /** 0 à 100, ou `null` quand l'étape n'a pas d'avancement mesurable. */
  pourcentage: number | null;
  faites?: number;
  total?: number;
}

export interface ReglagesSimulation {
  budget: number;
  intensite: number;
  fuite: number;
  bruit: number;
  amortissement: number;
  graine: number;
}

interface ValeurContexte {
  jeuId: string | null;
  etat: 'vide' | 'chargement' | 'echec' | 'pret';
  erreur: string | null;
  reponse: ReponseSimulation | null;
  periode: Periode;
  setPeriode: (p: Periode) => void;
  vue: VueSimulation | null;
  courbe: PointCourbe[];
  zoneActive: string | null;
  setZoneActive: (id: string | null) => void;
  progression: Progression | null;
  /** Lance la simulation v1 sur une version d'extraction. */
  simuler: (version: number, reglages: Partial<ReglagesSimulation>) => Promise<void>;
  recaler: () => Promise<void>;
  purger: () => Promise<void>;
  recharger: () => Promise<void>;
}

const Contexte = createContext<ValeurContexte | null>(null);

/** Lit un flux NDJSON ligne par ligne, et rend le dernier événement. */
async function lireFlux(
  reponse: Response,
  surEvenement: (e: EvenementSimulation) => void,
): Promise<EvenementSimulation | null> {
  if (!reponse.body) return null;
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = '';
  let dernier: EvenementSimulation | null = null;
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += decodeur.decode(value, { stream: true });
    let i: number;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if (!ligne) continue;
      try {
        dernier = JSON.parse(ligne) as EvenementSimulation;
        surEvenement(dernier);
      } catch { /* une ligne illisible ne doit pas couper la progression */ }
    }
  }
  return dernier;
}

export function FournisseurSimulation({
  jeuId, actif, children,
}: { jeuId: string | null; actif: boolean; children: React.ReactNode }) {
  const [etat, setEtat] = useState<ValeurContexte['etat']>('vide');
  const [erreur, setErreur] = useState<string | null>(null);
  const [reponse, setReponse] = useState<ReponseSimulation | null>(null);
  const [periode, setPeriode] = useState<Periode>('tout');
  const [zoneActive, setZoneActive] = useState<string | null>(null);
  const [progression, setProgression] = useState<Progression | null>(null);
  /** Le jeu dont `reponse` décrit la simulation : une réponse d'un autre jeu est périmée. */
  const jeuCharge = useRef<string | null>(null);
  /** Numéro de la dernière lecture : une réponse arrivée après une plus récente est ignorée. */
  const lecture = useRef(0);

  usePiste('simulation', progression?.message ?? 'Simulation de la campagne', progression !== null);
  usePiste('simulation-lecture', 'Lecture de la simulation', etat === 'chargement' && progression === null);

  const recharger = useCallback(async () => {
    if (!jeuId) { setEtat('vide'); setReponse(null); return; }
    const n = ++lecture.current;
    setEtat('chargement');
    setErreur(null);
    try {
      const r = await adminFetch(`/api/zones/jeux/${jeuId}/simulation`, { cache: 'no-store' });
      const data = await r.json();
      if (n !== lecture.current) return;
      if (!r.ok) throw new Error(data?.error ?? 'Simulation illisible.');
      jeuCharge.current = jeuId;
      setReponse(data as ReponseSimulation);
      setEtat('pret');
    } catch (e) {
      if (n !== lecture.current) return;
      setErreur(e instanceof Error ? e.message : 'Simulation illisible.');
      setEtat('echec');
    }
  }, [jeuId]);

  // Chargement à la première ouverture de l'étape ⑤, puis à chaque changement de jeu.
  useEffect(() => {
    if (!actif) return;
    if (jeuCharge.current === jeuId && reponse) return;
    void recharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, jeuId]);

  /** Envoie une requête NDJSON et suit sa progression jusqu'au bout. */
  const executer = useCallback(async (url: string, init: RequestInit, libelle: string) => {
    setProgression({ message: libelle, pourcentage: null });
    setErreur(null);
    try {
      const r = await adminFetch(url, init);
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.error ?? 'La simulation a échoué.');
      }
      const fin = await lireFlux(r, (e) => {
        if (e.etape === 'insertion') {
          setProgression({ message: e.message, pourcentage: e.pourcentage, faites: e.faites, total: e.total });
        } else if (e.etape === 'preparation' || e.etape === 'generation') {
          setProgression({ message: e.message, pourcentage: null });
        }
      });
      if (!fin || fin.etape === 'erreur') {
        throw new Error(fin?.etape === 'erreur' ? fin.message : 'Le flux s’est interrompu avant la fin.');
      }
      setProgression(null);
      await recharger();
    } catch (e) {
      setProgression(null);
      setErreur(e instanceof Error ? e.message : 'La simulation a échoué.');
      setEtat('echec');
    }
  }, [recharger]);

  const simuler = useCallback(async (version: number, reglages: Partial<ReglagesSimulation>) => {
    if (!jeuId) return;
    await executer(`/api/zones/jeux/${jeuId}/simulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, params: reglages }),
    }, 'Préparation de la simulation');
    setPeriode('v1');
  }, [jeuId, executer]);

  const recaler = useCallback(async () => {
    if (!jeuId) return;
    await executer(`/api/zones/jeux/${jeuId}/simulation/recaler`, { method: 'POST' }, 'Recalage du plan');
    setPeriode('tout');
  }, [jeuId, executer]);

  const purger = useCallback(async () => {
    if (!jeuId) return;
    setProgression({ message: 'Purge de la simulation', pourcentage: null });
    try {
      const r = await adminFetch(`/api/zones/jeux/${jeuId}/simulation`, { method: 'DELETE' });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.error ?? 'Purge impossible.');
      }
      setProgression(null);
      await recharger();
    } catch (e) {
      setProgression(null);
      setErreur(e instanceof Error ? e.message : 'Purge impossible.');
    }
  }, [jeuId, recharger]);

  const reponseValide = jeuCharge.current === jeuId ? reponse : null;
  const vue = useMemo(() => (reponseValide ? construireVue(reponseValide, periode) : null), [reponseValide, periode]);
  const courbe = useMemo(() => (reponseValide ? courbeAlignement(reponseValide) : []), [reponseValide]);

  const valeur = useMemo<ValeurContexte>(() => ({
    jeuId, etat, erreur, reponse: reponseValide, periode, setPeriode, vue, courbe,
    zoneActive, setZoneActive, progression, simuler, recaler, purger, recharger,
  }), [jeuId, etat, erreur, reponseValide, periode, vue, courbe, zoneActive, progression,
    simuler, recaler, purger, recharger]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** L'état de la simulation. Lève hors du fournisseur : un oubli se voit tout de suite. */
export function useSimulation(): ValeurContexte {
  const v = useContext(Contexte);
  if (!v) throw new Error('useSimulation doit être appelé sous <FournisseurSimulation>.');
  return v;
}

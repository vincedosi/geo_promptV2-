'use client';

/**
 * « Voir sur la carte » — allume les zones du profil courant.
 *
 * ── DEUX GESTES EN UN, ET C'EST VOULU ────────────────────────────────────
 *
 * Il prépare la géométrie du profil, PUIS l'allume. Séparer les deux
 * donnerait à l'utilisateur un bouton qui ne fait rien la première fois : la
 * couche demanderait des tuiles sous une clé que personne n'a construite, et
 * MapLibre échouerait en SILENCE sur une source vide — le défaut exact qui a
 * rendu la couche IRIS muette pendant des mois.
 *
 * ── POURQUOI IL FERME L'OVERLAY ──────────────────────────────────────────
 *
 * La carte est derrière. Allumer une couche sans rendre la carte visible
 * produirait un bouton dont l'effet est invisible, ce qui se lit comme un
 * bouton cassé.
 */
import React, { useState } from 'react';
import { Map as IconeCarte, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/admin-fetch';
import { codeProfil } from '@/lib/risques/code-profil';
import { anneauxDuNiveau, NIVEAUX, type ProfilRayons } from '@/lib/risques/profil';
import {
  ZONES_RISQUE_EVENT, type ZonesRisqueEventDetail,
} from '@/app/map/_components/ZonesRisqueLayer';
import { fInter } from '@/lib/design/polices';

interface Props {
  profil: ProfilRayons;
  /** Ferme l'overlay pour découvrir la carte. */
  onFermer: () => void;
}

export function BoutonVoirCarte({ profil, onFermer }: Props) {
  const [etat, setEtat] = useState<'repos' | 'preparation' | 'echec'>('repos');
  const [message, setMessage] = useState<string | null>(null);

  /*
   * Un profil sans aucun anneau ne dessine rien. Le bouton le dit AVANT de
   * partir en requête : un aller-retour qui rend « zéro classe » laisserait
   * croire à une panne.
   */
  const vide = NIVEAUX.every((n) => anneauxDuNiveau(profil, n).length === 0);

  const voir = async () => {
    setEtat('preparation');
    setMessage(null);
    try {
      const r = await adminFetch('/api/risques/zones/preparer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profil: codeProfil(profil) }),
      });
      const corps = await r.json();
      if (!r.ok) {
        setEtat('echec');
        setMessage(corps?.error ?? 'Préparation des zones impossible.');
        return;
      }
      if ((corps?.classes ?? 0) === 0) {
        setEtat('echec');
        setMessage('Ce profil ne délimite aucune zone : aucun anneau n’est réglé.');
        return;
      }

      window.dispatchEvent(
        new CustomEvent<ZonesRisqueEventDetail>(ZONES_RISQUE_EVENT, { detail: { profil } }),
      );
      setEtat('repos');
      onFermer();
    } catch {
      setEtat('echec');
      setMessage('La préparation des zones n’a pas répondu.');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        onClick={voir}
        disabled={etat === 'preparation' || vide}
        title={vide
          ? 'Réglez au moins un anneau pour délimiter une zone.'
          : 'Afficher les zones de ce profil sur la carte'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'transparent',
          border: `0.5px solid ${vide ? 'var(--border-default)' : 'var(--brand-teal)'}`,
          borderRadius: 6, padding: '6px 12px',
          cursor: etat === 'preparation' || vide ? 'not-allowed' : 'pointer',
          fontFamily: fInter, fontSize: 12, fontWeight: 500,
          color: vide ? 'var(--text-tertiary)' : 'var(--brand-teal)',
        }}
      >
        {etat === 'preparation'
          ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          : <IconeCarte size={13} />}
        Voir sur la carte
      </button>
      {message && (
        <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--danger)' }}>{message}</span>
      )}
    </div>
  );
}

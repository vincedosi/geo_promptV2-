'use client';

/**
 * La réglette de rayon, dans la barre commune — une par niveau réglementaire.
 *
 * ── CE QU'ELLE RÈGLE, ET CE QU'ELLE NE RÈGLE PAS ──────────────────────────
 *
 * Elle déplace le **bord** de la zone d'un niveau, c'est-à-dire son anneau
 * extérieur. Un niveau peut en porter jusqu'à quatre (`ANNEAUX_MAX`) et le
 * profil par défaut en a trois sur le seuil haut : une réglette ne peut donc
 * pas représenter « le » rayon du niveau. Les anneaux intérieurs restent
 * réglables par les chips de l'atelier, et ils sont rappelés en gris à gauche
 * de la valeur pour qu'on voie ce que la réglette ne touche pas.
 *
 * ── POURQUOI LE CALCUL NE PART QU'AU RELÂCHEMENT ──────────────────────────
 *
 * `population_par_classe` coûte ~2,8 s sur la France entière. Une requête par
 * position du curseur serait la famille exacte de l'incident du 28/03. La
 * valeur bouge donc en local pendant le glissement — lecture immédiate — et
 * le profil n'est écrit qu'au relâchement de la souris, du doigt ou de la
 * touche. C'est le patron déjà employé par le curseur de dilution de l'onglet
 * Zones, repris tel quel plutôt que réinventé.
 *
 * ── LE PAS EST CELUI DU PRÉ-CALCUL ────────────────────────────────────────
 *
 * 100 m, parce que `couverture_rayon_risque` est agrégée par paliers de 100 m.
 * Un pas plus fin déplacerait une frontière entre deux paliers sans qu'aucun
 * chiffre ne bouge : le curseur aurait l'air cassé.
 *
 * ── « AUTRES RÉGIMES » N'A PAS DE RÉGLETTE ────────────────────────────────
 *
 * Le pré-calcul ne porte que les deux niveaux Seveso. Une troisième réglette
 * inerte dans la barre se lirait comme un réglage disponible ; l'atelier, lui,
 * affiche le niveau désactivé AVEC sa raison, parce que c'est là qu'on vient
 * chercher pourquoi.
 */
import React, { useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
import {
  anneauxDuNiveau, poserRayonExterieur, normaliserProfil, libelleRayon,
  LIBELLE_NIVEAU, RAYON_MIN_M, RAYON_MAX_M, PAS_RAYON_M,
  type Niveau, type ProfilRayons,
} from '@/lib/risques/profil';
import { fInter, fMono } from '@/lib/design/polices';

/**
 * Les niveaux que le pré-calcul sait classer.
 *
 * ⚠ Dérivé de la donnée disponible, jamais de `NIVEAUX` : ce dernier porte
 * aussi `autres`, dont `carreau_risque_distance` ne mesure aucune distance.
 * Lui donner une réglette rendrait un curseur qui ne change aucun chiffre.
 */
const NIVEAUX_REGLABLES: readonly Niveau[] = ['haut', 'bas'];

interface Props {
  profil: ProfilRayons;
  onProfil: (p: ProfilRayons) => void;
}

export function RegletteRayons({ profil, onProfil }: Props) {
  /*
   * Cadenas fermé : UNE réglette, celle du seuil haut, dont les autres niveaux
   * héritent. Deux réglettes qui bougeraient ensemble diraient la même chose
   * deux fois, et laisseraient croire qu'on peut les désynchroniser sans
   * toucher au cadenas.
   */
  const niveaux = profil.lie ? (['haut'] as const) : NIVEAUX_REGLABLES;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
      {niveaux.map((niveau) => (
        <Reglette
          key={niveau}
          profil={profil}
          niveau={niveau}
          libelle={profil.lie ? 'Tous les niveaux' : LIBELLE_NIVEAU[niveau]}
          onProfil={onProfil}
        />
      ))}

      <button
        type="button"
        onClick={() => onProfil(normaliserProfil({ ...profil, lie: !profil.lie }))}
        aria-pressed={profil.lie}
        title={profil.lie
          ? 'Les niveaux partagent les mêmes anneaux. Cliquez pour leur en donner de propres — c’est ce qui permet le bidding différencié.'
          : 'Donner à tous les niveaux les anneaux du seuil haut, pour comparer à périmètre égal. ⚠ Les anneaux propres du seuil bas sont alors écrasés, et les délier ne les restaure pas.'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'none', border: 0, cursor: 'pointer',
          padding: '0 0 6px',
          fontFamily: fInter, fontSize: 11,
          color: profil.lie ? 'var(--brand-teal)' : 'var(--text-tertiary)',
        }}
      >
        {profil.lie ? <Lock size={12} /> : <Unlock size={12} />}
        {profil.lie ? 'niveaux liés' : 'lier les niveaux'}
      </button>
    </div>
  );
}

/** Une réglette : le bord d'un niveau, ses anneaux intérieurs rappelés. */
function Reglette({
  profil, niveau, libelle, onProfil,
}: Props & { niveau: Niveau; libelle: string }) {
  /*
   * `null` = rien en cours de glissement, donc on affiche la valeur du profil.
   * Remettre `null` au relâchement fait retomber l'affichage sur ce que le
   * profil a réellement retenu — y compris quand la garde a ramené le bord
   * au-dessus d'un anneau intérieur. Sans cela, le curseur montrerait la
   * position demandée pendant que les chiffres décrivent une autre zone.
   */
  const [glisse, setGlisse] = useState<number | null>(null);

  const anneaux = anneauxDuNiveau(profil, niveau);
  const bord = anneaux.length > 0 ? anneaux[anneaux.length - 1] : RAYON_MIN_M;
  const interieurs = anneaux.slice(0, -1);
  const affiche = glisse ?? bord;

  const poser = () => {
    if (glisse !== null) onProfil(poserRayonExterieur(profil, niveau, glisse));
    setGlisse(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 210 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
          {libelle}
        </span>
        {interieurs.length > 0 && (
          <span
            title="Anneaux intérieurs — réglables dans l’atelier, la réglette ne déplace que le bord."
            style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}
          >
            {interieurs.map(libelleRayon).join(' · ')} ·
          </span>
        )}
        <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--brand-teal)' }}>
          {libelleRayon(affiche)}
        </span>
      </div>
      <input
        type="range"
        min={RAYON_MIN_M}
        max={RAYON_MAX_M}
        step={PAS_RAYON_M}
        value={affiche}
        onChange={(e) => setGlisse(Number(e.target.value))}
        onMouseUp={poser}
        onTouchEnd={poser}
        onKeyUp={poser}
        onBlur={poser}
        aria-label={`Bord de la zone — ${libelle}, de ${RAYON_MIN_M} à ${RAYON_MAX_M} mètres`}
        style={{ width: '100%', accentColor: 'var(--brand-teal)' }}
      />
    </div>
  );
}

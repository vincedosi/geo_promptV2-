'use client';

/**
 * ③ Couverture — la population exposée, listée à la maille choisie.
 *
 * ── CE QU'IL REMPLACE, ET POURQUOI ────────────────────────────────────────
 *
 * L'onglet « Territoires » tirait ses chiffres de `/api/risques/exposition/
 * agregats`, qui croise des tampons avec les 2,3 millions de carreaux EN
 * DIRECT. Ce moteur porte un garde-fou de surface — légitime, il a été posé
 * après une attente sans fin en production — qui **plafonne le rayon national
 * à 1 179 m**. Le profil de l'écran, lui, en demandait 5 000.
 *
 * L'onglet ne pouvait donc pas honorer le profil affiché dans son propre
 * en-tête, et s'était vu doter d'une réglette à part, marquée « Propre à
 * Territoires ». Deux totaux pour un seul profil : **390 112 d'un côté,
 * 24 406 618 de l'autre**, mesurés le 2026-09-20.
 *
 * ⚠ **Synchroniser les deux réglettes n'aurait rien réglé** : poser 5 km sur
 * l'ancien moteur lui fait rendre un refus, pas un chiffre. Ce panneau lit donc
 * `population_par_classe` — le MÊME moteur que le tableau des bandes, la même
 * affectation exclusive, la même source pré-calculée — à qui sql/221 a ajouté
 * les mailles région et code postal qui lui manquaient.
 *
 * ── CE QU'IL FAUT SAVOIR AVANT DE LIRE SES CHIFFRES ───────────────────────
 *
 * **Un carreau INSEE de 200 m appartient à UNE seule unité et à UNE seule
 * classe.** C'est ce qui rend la colonne population additive : la somme des
 * lignes affichées, plus celles que la troncature écarte, égale le total.
 *
 * **La part et la densité manquent au code postal, et c'est délibéré.** Le seul
 * référentiel de population par code postal surcompte de 10,5 % — un carreau y
 * est compté dans chaque contour qui le recouvre. Une colonne vide qui
 * s'explique vaut mieux qu'un pourcentage faux qui colore une carte.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterNombre } from '@/lib/format/nombre';
import { Th, Td } from '@/components/risques/elements';
import { Kpi } from '@/components/risques/Kpi';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import { LIBELLE_DIMENSION, type Dimension } from '@/lib/risques/dimensions';
import type { ProfilRayons } from '@/lib/risques/profil';
import type { Bandes, EtatChargement, UniteBandes } from '@/components/risques/use-bandes';

interface Props {
  bandes: Bandes | null;
  etat: EtatChargement;
  erreur: string | null;
  /** Le pré-calcul manque : une construction à faire, pas une panne. */
  aConstruire: boolean;
  maille: Dimension;
  /** Le profil courant, pour nommer les bandes de chaque classe. */
  profil: ProfilRayons;
  /** Libellé de la cible comptée, tel que le catalogue l'écrit. */
  libelleCible: string;
  /** Peut-on descendre d'un cran depuis cette maille ? */
  descendable: boolean;
  onDescendre: (code: string, nom: string) => void;
  /** Code de l'unité survolée, relayé à la carte. */
  actif: string | null;
  onSurvol: (code: string | null) => void;
}

/**
 * Part de la population de l'unité qui est exposée.
 *
 * ⚠ Rendue `null` et non 0 quand le dénominateur manque : 0 % se lirait
 * « personne n'est exposé ici », alors que la vérité est « on ne sait pas dire
 * sur quelle population rapporter ».
 */
function part(u: UniteBandes): number | null {
  if (u.pop_totale === null || u.pop_totale <= 0) return null;
  return Math.round((u.total / u.pop_totale) * 1000) / 10;
}

/** Habitants exposés au kilomètre carré de l'unité. Même règle sur le `null`. */
function densite(u: UniteBandes): number | null {
  if (u.surface_km2 === null || u.surface_km2 <= 0) return null;
  return Math.round(u.total / u.surface_km2);
}

export function TableauCouverture({
  bandes, etat, erreur, aConstruire, maille, profil, libelleCible,
  descendable, onDescendre, actif, onSurvol,
}: Props) {
  const anneaux = React.useMemo(() => anneauxParNiveau(profil), [profil]);

  if (etat === 'chargement' && !bandes) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        color: 'var(--text-tertiary)', fontFamily: fInter, fontSize: 12,
      }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        Calcul en cours…
      </div>
    );
  }

  if (etat === 'echec') {
    return (
      <div style={{ fontFamily: fInter, fontSize: 12, lineHeight: 1.6 }}>
        <p style={{ color: 'var(--danger)' }}>{erreur ?? 'Calcul indisponible.'}</p>
        {/*
          `aConstruire` distingue « le pré-calcul n'existe pas » — quelque chose
          à lancer — de « ce territoire n'est pas carroyé par l'INSEE », où
          aucune construction n'y changera rien. Confondre les deux envoyait
          l'utilisateur lancer un script impuissant.
        */}
        {aConstruire && (
          <p style={{ color: 'var(--text-tertiary)', marginTop: 8, fontFamily: fMono, fontSize: 11 }}>
            node scripts/construire_carreau_risque.mjs
          </p>
        )}
      </div>
    );
  }

  if (!bandes) return null;

  const unites = bandes.unites ?? [];
  const classes = Object.entries(bandes.par_classe ?? {})
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div style={{ display: 'flex', gap: 28, marginBottom: 16, flexWrap: 'wrap' }}>
        <Kpi
          valeur={formaterNombre(bandes.total)}
          libelle={libelleCible.toLowerCase()}
          note="la somme des lignes égale ce total"
          accent
        />
        <Kpi
          valeur={formaterNombre(bandes.n_unites)}
          libelle={`${LIBELLE_DIMENSION[maille].toLowerCase()}s exposés`}
          note="unités portant au moins un habitant exposé"
        />
        <Kpi
          valeur={formaterNombre(bandes.n_carreaux)}
          libelle="carreaux retenus"
          note="un carreau de 200 m, une seule classe"
        />
      </div>

      {/*
        La ventilation par classe, en tête plutôt qu'en pied : c'est elle qui
        dit de QUOI le total est fait, et elle est invariante à la maille —
        contrairement au tableau, qui change de découpage sous les yeux.
      */}
      {classes.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16,
        }}>
          {classes.map(([c, v]) => (
            <span
              key={c}
              style={{
                fontFamily: fInter, fontSize: 11, color: 'var(--text-secondary)',
                background: 'var(--bg-level-3)',
                border: '0.5px solid var(--border-subtle)',
                borderRadius: 4, padding: '3px 9px',
              }}
            >
              {libelleClasse(c, anneaux)}
              <span style={{ fontFamily: fMono, marginLeft: 7, color: 'var(--text-primary)' }}>
                {formaterNombre(v)}
              </span>
            </span>
          ))}
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fInter, fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
            <Th align="left">{LIBELLE_DIMENSION[maille]}</Th>
            <Th>{libelleCible}</Th>
            <Th titre={
              maille === 'code_postal'
                ? 'Indisponible au code postal : le seul référentiel de population à cette maille surcompte de 10,5 %.'
                : 'Part de la population de l’unité qui vit dans une zone du profil.'
            }>
              Part
            </Th>
            <Th titre={
              maille === 'code_postal'
                ? 'Indisponible au code postal, même raison que la part.'
                : 'Habitants exposés par kilomètre carré de l’unité.'
            }>
              Densité
            </Th>
          </tr>
        </thead>
        <tbody>
          {unites.map((u) => {
            const p = part(u);
            const d = densite(u);
            return (
              <tr
                key={u.unite}
                onMouseEnter={() => onSurvol(u.unite)}
                onMouseLeave={() => onSurvol(null)}
                onClick={descendable ? () => onDescendre(u.unite, u.nom ?? u.unite) : undefined}
                title={descendable ? `Descendre dans ${u.nom ?? u.unite}` : undefined}
                style={{
                  borderBottom: '0.5px solid var(--border-subtle)',
                  background: actif === u.unite ? 'var(--brand-teal-10)' : 'transparent',
                  transition: 'background-color 150ms var(--ease-out)',
                  cursor: descendable ? 'pointer' : 'default',
                }}
              >
                <td style={{ padding: '7px 8px', color: 'var(--text-primary)' }}>
                  <span style={{
                    fontFamily: fMono, fontSize: 10,
                    color: 'var(--text-tertiary)', marginRight: 7,
                  }}>
                    {u.unite}
                  </span>
                  {/*
                    Le code seul plutôt qu'un libellé inventé : une unité absente
                    du référentiel garde sa ligne et sa population, ce qui vaut
                    mieux que de la faire disparaître du tableau.
                  */}
                  {u.nom ?? ''}
                  {descendable && (
                    <span aria-hidden style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                      &rsaquo;
                    </span>
                  )}
                </td>
                <Td fort>{formaterNombre(u.total)}</Td>
                <Td>{p !== null ? `${formaterNombre(p)} %` : '—'}</Td>
                <Td>{d !== null ? formaterNombre(d) : '—'}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {unites.length === 0 && (
        <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
          Aucune population exposée pour ces filtres.
        </p>
      )}

      {bandes.tronquee && (
        <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--warning)', marginTop: 10 }}>
          Liste tronquée : {formaterNombre(bandes.n_unites)} unités exposées, les plus peuplées
          seulement sont affichées. Le total ci-dessus les compte toutes.
        </p>
      )}

      {/*
        L'avertissement qui empêche la mauvaise lecture la plus probable, et qui
        n'a rien perdu en changeant de moteur : `hors_zone` compte des habitants
        de carreaux PROCHES d'un site que le profil ne retient pas — pas la
        population non exposée de France, la table ne portant que des carreaux à
        moins de 10 km d'un site.
      */}
      <p style={{
        fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)',
        marginTop: 14, lineHeight: 1.5,
      }}>
        Un carreau INSEE de 200 m appartient à une seule unité et à une seule classe : la somme de
        la colonne population <strong style={{ fontWeight: 500 }}>égale</strong> le total, à
        n’importe quelle maille.{' '}
        {formaterNombre(bandes.hors_zone)} habitants vivent à moins de 10 km d’un site sans être
        retenus par les anneaux de ce profil — ce n’est pas la population non exposée de France.
        {maille === 'code_postal' && (
          <> Ni part ni densité à cette maille : le seul référentiel de population par code postal
            surcompte de 10,5 %.
          </>
        )}
      </p>
    </>
  );
}

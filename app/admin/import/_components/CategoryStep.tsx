'use client';

/**
 * Étape 02 du wizard d'import — choix de la catégorie POI.
 *
 * La liste vient de `/api/admin/poi-categories` (jamais de catégories en dur) ;
 * le volet dépliant permet d'en créer une à la volée et recharge la liste.
 *
 * JSX repris tel quel de page.tsx (2026-09-03), la création de catégorie étant
 * sortie du JSX vers `handleCreateCategory` sans changer une ligne de logique.
 */

import React from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { C, fontInter, fontMono, Spinner, type PoiCategoryOption } from './shared';
import {
  btnSuccess,
  card, cardBody, cardHeader, cardTitle,
  inputStyle, sLabel, stepNum,
} from './styles';

export interface CategoryStepProps {
  category: string;
  setCategory: (v: string) => void;
  poiCategories: PoiCategoryOption[];
  setPoiCategories: (v: PoiCategoryOption[]) => void;
  newCategoryName: string;
  setNewCategoryName: (v: string) => void;
  isCreatingCategory: boolean;
  setIsCreatingCategory: (v: boolean) => void;
}

export function CategoryStep({
  category,
  setCategory,
  poiCategories,
  setPoiCategories,
  newCategoryName,
  setNewCategoryName,
  isCreatingCategory,
  setIsCreatingCategory,
}: CategoryStepProps) {
  /** Crée la catégorie saisie, recharge la liste puis la sélectionne. */
  const handleCreateCategory = async () => {
    setIsCreatingCategory(true);
    try {
      const res = await adminFetch('/api/admin/poi-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categorie: newCategoryName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        const res2 = await adminFetch('/api/admin/poi-categories');
        const data2 = await res2.json();
        if (data2.success) {
          const cats = data2.categories.map((c: { categorie: string; label_fr: string; icone: string }) => ({
            val: c.categorie, label: c.label_fr || c.categorie, icone: c.icone || '',
          }));
          setPoiCategories(cats);
        }
        setCategory(data.categorie);
        setNewCategoryName('');
      }
    } catch { /* ignore */ } finally {
      setIsCreatingCategory(false);
    }
  };

  return (
        <div style={card}>
          <div style={cardHeader}>
            <span style={stepNum}>02</span>
            <span style={cardTitle}>Categorie POI</span>
          </div>
          <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={sLabel}>Categorie</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{ ...inputStyle, maxWidth: 300, color: category ? undefined : C.muted }}
                >
                  <option value="" disabled>-- Choisir une categorie --</option>
                  {poiCategories.map((c) => (
                    <option key={c.val} value={c.val}>{c.icone ? `${c.icone} ${c.label}` : c.label}</option>
                  ))}
                </select>
                {poiCategories.length === 0 && (
                  <span style={{ fontFamily: fontMono, fontSize: 10, color: C.muted }}>Chargement...</span>
                )}
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontFamily: fontInter, fontSize: 9, fontWeight: 500, color: C.accent, cursor: 'pointer' }}>
                  + Creer une nouvelle categorie
                </summary>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Ex: cirfa, commerce, sante..."
                    style={{ ...inputStyle, maxWidth: 250, fontSize: 11, padding: '5px 8px' }}
                  />
                  <button
                    style={{ ...btnSuccess, opacity: (!newCategoryName.trim() || isCreatingCategory) ? 0.5 : 1 }}
                    disabled={!newCategoryName.trim() || isCreatingCategory}
                    onClick={handleCreateCategory}
                  >
                    {isCreatingCategory ? <Spinner size={10} /> : 'Creer'}
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>
  );
}

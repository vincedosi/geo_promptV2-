/**
 * GENESIS — API Route — GET/POST /api/admin/poi-categories
 * GET:  List all active POI categories from poi_categories table
 * POST: Create a new category on-the-fly
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { z } from 'zod';
import { lireCorps } from '@/lib/api/valider-corps';

/** Le message « Nom de categorie requis » est conserve : c'est lui qu'affiche l'UI. */
const CreerCategorieSchema = z.object({
  categorie: z.string().trim().min(1, 'Nom de categorie requis'),
  label_fr: z.string().optional(),
  icone: z.string().optional(),
  couleur_carte: z.string().optional(),
  description: z.string().optional(),
});

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('poi_categories')
      .select('id, categorie, sous_categorie, label_fr, icone, couleur_carte, description, actif')
      .eq('actif', true)
      .order('label_fr');

    if (error) {
      console.error('[POI-CATEGORIES] Error:', error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, categories: data || [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  try {
    const corps = await lireCorps(request, CreerCategorieSchema);
    if (!corps.ok) return NextResponse.json({ success: false, error: corps.message }, { status: 400 });
    const { categorie, label_fr, icone, couleur_carte, description } = corps.valeur;

    // Normalize: lowercase, no accents, no spaces
    const normalized = categorie.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const supabase = createAdminClient();

    // Check if already exists
    const { data: existing } = await supabase
      .from('poi_categories')
      .select('categorie')
      .eq('categorie', normalized)
      .single();

    if (existing) {
      return NextResponse.json({ success: true, categorie: normalized, message: 'Categorie existante' });
    }

    // Pick a random color from a palette
    const colors = ['#4A90D9', '#6366F1', '#EC4899', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#14B8A6', '#F97316', '#06B6D4'];
    const randomColor = couleur_carte || colors[Math.floor(Math.random() * colors.length)];

    const { error } = await supabase
      .from('poi_categories')
      .insert({
        categorie: normalized,
        sous_categorie: 'tous',
        label_fr: label_fr || categorie.trim(),
        icone: icone || '📍',
        couleur_carte: randomColor,
        actif: true,
        description: description || `Categorie ${categorie.trim()}`,
      });

    if (error) {
      console.error('[POI-CATEGORIES] Insert error:', error.message);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, categorie: normalized });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur interne';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

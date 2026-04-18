/**
 * GENESIS — API Route — GET/POST /api/admin/poi-categories
 * GET:  List all active POI categories from poi_categories table
 * POST: Create a new category on-the-fly
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';

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
    const body = await request.json();
    const { categorie, label_fr, icone, couleur_carte, description } = body as {
      categorie: string;
      label_fr?: string;
      icone?: string;
      couleur_carte?: string;
      description?: string;
    };

    if (!categorie || !categorie.trim()) {
      return NextResponse.json({ success: false, error: 'Nom de categorie requis' }, { status: 400 });
    }

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

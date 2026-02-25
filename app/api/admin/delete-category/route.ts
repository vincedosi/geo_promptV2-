import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/auth";

/**
 * POST /api/admin/delete-category
 * Supprime une catégorie et tous les POI associés.
 */
export async function POST(request: Request) {
  try {
    const { category, source_id } = await request.json();
    if (!category) {
      return NextResponse.json({ error: "category requis" }, { status: 400 });
    }
    const supabase = createAdminClient();
    let query = supabase.from("poi_france").delete().eq("categorie", category);
    if (source_id) query = query.eq("source_id", source_id);
    const { error, count } = await query;
    if (error) throw error;
    return NextResponse.json({ deleted: count ?? 0, category });
  } catch (error) {
    console.error("[DELETE-CATEGORY]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

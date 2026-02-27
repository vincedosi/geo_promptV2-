import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/auth";

/**
 * POST /api/admin/delete-source
 * Supprime une source et tous ses POI.
 */
export async function POST(request: Request) {
  try {
    const { source_id } = await request.json();
    if (!source_id) {
      return NextResponse.json({ error: "source_id requis" }, { status: 400 });
    }
    const supabase = createAdminClient();
    // Delete POIs first
    const { error: poiErr } = await supabase.from("poi").delete().eq("source_id", source_id);
    if (poiErr) throw poiErr;
    // Delete the source
    const { error: srcErr } = await supabase.from("data_sources").delete().eq("id", source_id);
    if (srcErr) throw srcErr;
    return NextResponse.json({ deleted: true, source_id });
  } catch (error) {
    console.error("[DELETE-SOURCE]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}

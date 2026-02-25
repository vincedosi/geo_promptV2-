import { NextResponse } from "next/server";

/**
 * Catch-all auth route.
 * Auth is handled client-side via Supabase JS SDK.
 * This route exists to avoid 404s if the client calls /api/auth/*.
 */
export async function GET() {
  return NextResponse.json({ provider: "supabase", status: "ok" });
}

export async function POST() {
  return NextResponse.json({ provider: "supabase", status: "ok" });
}

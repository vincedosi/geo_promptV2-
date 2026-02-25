import { NextResponse } from "next/server";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export function handleApiError(error: unknown) {
  console.error("[API]", error);
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Erreur serveur";
  return NextResponse.json({ error: message }, { status: 500 });
}

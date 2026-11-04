"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { CustomGeoCaptureProvider } from "@/lib/custom-geo/CustomGeoCaptureContext";
// CustomGeoCaptureButton flottant supprimé — l'action est maintenant dans SettingsOverlay
// (overlay Réglages depuis le rail de navigation).

export default function MapLayout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();

  useEffect(() => {
    if (isLoading || session) return;
    if (process.env.NODE_ENV === "development") {
      console.warn("[MapLayout] Pas de session — accès autorisé en développement.");
    }
  }, [isLoading, session]);

  // Hors développement, sans session : plus de page de connexion vers laquelle
  // rediriger (supprimée le 2026-11-05) — la session est ouverte par AIDA.
  if (!session && process.env.NODE_ENV !== "development") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "var(--bg-primary)",
        fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary)", fontSize: 13,
        padding: 16, textAlign: "center",
      }}>
        {isLoading ? "Vérification de la session…" : "Session absente : la connexion est gérée par AIDA."}
      </div>
    );
  }

  return (
    <CustomGeoCaptureProvider>
      {children}
    </CustomGeoCaptureProvider>
  );
}

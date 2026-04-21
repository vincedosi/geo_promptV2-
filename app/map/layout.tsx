"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { CustomGeoCaptureProvider } from "@/lib/custom-geo/CustomGeoCaptureContext";
// CustomGeoCaptureButton flottant supprimé — l'action est maintenant dans SettingsOverlay
// (overlay Réglages depuis la nouvelle IconBar).

export default function MapLayout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (session) return;

    if (process.env.NODE_ENV === "development") {
      console.warn("[MapLayout] Pas de session — accès autorisé en développement.");
      return;
    }

    router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
  }, [isLoading, session, router, pathname]);

  // En prod : écran de chargement pendant la vérification, puis redirect
  if (!session && process.env.NODE_ENV !== "development") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "var(--bg-primary)",
        fontFamily: "JetBrains Mono, monospace", color: "var(--brand-teal)", fontSize: 13,
        letterSpacing: "0.05em",
      }}>
        {isLoading ? "vérification session..." : "redirection..."}
      </div>
    );
  }

  return (
    <CustomGeoCaptureProvider>
      {children}
    </CustomGeoCaptureProvider>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";

export default function CopiloteLayout({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useSession();
  const router   = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (session) return;

    if (process.env.NODE_ENV === "development") {
      console.warn("[CopiloteLayout] Pas de session — accès autorisé en développement.");
      return;
    }

    router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
  }, [isLoading, session, router, pathname]);

  // En prod : écran de chargement pendant la vérification, puis redirect
  if (!session && process.env.NODE_ENV !== "development") {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#050505",
        fontFamily: "JetBrains Mono, monospace", color: "#a855f7", fontSize: 13,
        letterSpacing: "0.05em",
      }}>
        {isLoading ? "vérification session..." : "redirection..."}
      </div>
    );
  }

  return <>{children}</>;
}

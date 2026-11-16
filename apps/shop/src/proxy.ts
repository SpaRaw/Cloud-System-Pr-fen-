import { NextResponse, type NextRequest } from "next/server";

// Admin-Schutz über Easy Auth (Container Apps, Entra ID). Easy Auth steht vor der App und setzt nach dem
// Login den Header x-ms-client-principal-name. Nicht angemeldet -> Weiterleitung zum Entra-Login.
// Optional: ADMIN_EMAILS=a@x.de,b@y.de schränkt auf bestimmte Konten ein. Lokal: ADMIN_DEV_BYPASS=true.
export function proxy(req: NextRequest) {
  if (process.env.ADMIN_DEV_BYPASS === "true") return NextResponse.next();
  const nutzer = req.headers.get("x-ms-client-principal-name");
  if (!nutzer) {
    const ziel = encodeURIComponent(req.nextUrl.pathname);
    return NextResponse.redirect(new URL(`/.auth/login/aad?post_login_redirect_uri=${ziel}`, req.url));
  }
  const erlaubt = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (erlaubt.length && !erlaubt.includes(nutzer.toLowerCase())) return new NextResponse("Kein Zugriff", { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };

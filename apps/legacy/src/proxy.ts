import { NextResponse, type NextRequest } from "next/server";

// Altsystem: Admin nur mit Basic Auth (Zugang aus der Umgebung, nicht im Code).
export function proxy(req: NextRequest) {
  const erwartet = process.env.ADMIN_BASIC_AUTH; // "benutzer:passwort"
  if (!erwartet) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header === `Basic ${btoa(erwartet)}`) return NextResponse.next();
  return new NextResponse("Anmeldung erforderlich", { status: 401, headers: { "www-authenticate": 'Basic realm="KlangWerk Admin"' } });
}

export const config = { matcher: ["/admin/:path*"] };

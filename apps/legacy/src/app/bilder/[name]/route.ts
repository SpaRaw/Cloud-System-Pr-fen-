import { dateiLesen } from "@/lib/dateien";

export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const bild = await dateiLesen("bilder", name);
  if (!bild) return new Response("Nicht gefunden", { status: 404 });
  const typ = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new Response(new Uint8Array(bild), { headers: { "content-type": typ, "cache-control": "public, max-age=3600" } });
}

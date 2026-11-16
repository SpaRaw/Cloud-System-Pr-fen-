import { blobLesen, CONTAINER_BILDER } from "@kw/core/storage";

export async function GET(_: Request, { params }: { params: Promise<{ pfad: string[] }> }) {
  const { pfad } = await params;
  const datei = await blobLesen(CONTAINER_BILDER, pfad.join("/"));
  if (!datei) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(datei.daten), { headers: { "content-type": datei.contentType, "cache-control": "public, max-age=86400, immutable" } });
}

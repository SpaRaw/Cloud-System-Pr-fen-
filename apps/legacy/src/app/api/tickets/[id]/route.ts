import { dateiLesen } from "@/lib/dateien";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pdf = await dateiLesen("tickets", `${id}.pdf`);
  if (!pdf) return new Response("Nicht gefunden", { status: 404 });
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf" } });
}

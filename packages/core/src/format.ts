export const euro = (cent: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cent / 100);
export const datum = (d: Date) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);

// datetime-local-Felder sind ohne Zeitzone. Wir interpretieren sie als Europe/Berlin.
function offsetMin(d: Date): number {
  const teile = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "longOffset" }).formatToParts(d);
  const tz = teile.find((t) => t.type === "timeZoneName")?.value ?? "GMT";
  const m = tz.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}
export function ausLokal(s: string): Date {
  const utc = new Date(`${s}:00Z`);
  return new Date(utc.getTime() - offsetMin(utc) * 60_000);
}
export function zuLokal(d: Date): string {
  const lokal = new Date(d.getTime() + offsetMin(d) * 60_000);
  return lokal.toISOString().slice(0, 16);
}

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { datum, euro } from "./format";

export type TicketDaten = {
  ticketId: string;
  platzNr: number;
  eventName: string;
  eventDatum: Date;
  preisCent: number;
  name: string;
  bestellungId: string;
};

/** Ein PDF mit einer Seite pro Ticket, jeweils mit QR-Code der Ticket-ID. */
export async function ticketPdf(tickets: TicketDaten[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const teal = rgb(0.05, 0.58, 0.53);

  for (const t of tickets) {
    const seite = pdf.addPage([420, 595]); // A5
    seite.drawRectangle({ x: 0, y: 515, width: 420, height: 80, color: teal });
    seite.drawText("KlangWerk Tickets", { x: 30, y: 550, size: 22, font: fett, color: rgb(1, 1, 1) });
    seite.drawText(t.eventName, { x: 30, y: 470, size: 18, font: fett });
    seite.drawText(datum(t.eventDatum), { x: 30, y: 448, size: 12, font: normal });
    seite.drawText(`Platz ${t.platzNr}`, { x: 30, y: 410, size: 28, font: fett, color: teal });
    seite.drawText(`Ausgestellt für: ${t.name}`, { x: 30, y: 380, size: 11, font: normal });
    seite.drawText(`Preis: ${euro(t.preisCent)}`, { x: 30, y: 364, size: 11, font: normal });
    seite.drawText(`Bestellung: ${t.bestellungId}`, { x: 30, y: 348, size: 8, font: normal });
    seite.drawText(`Ticket: ${t.ticketId}`, { x: 30, y: 336, size: 8, font: normal });
    const qr = await QRCode.toBuffer(t.ticketId, { margin: 1, width: 300 });
    const bild = await pdf.embedPng(qr);
    seite.drawImage(bild, { x: 110, y: 60, width: 200, height: 200 });
    seite.drawText("Testdaten – kein gültiges Ticket", { x: 115, y: 35, size: 9, font: normal, color: rgb(0.5, 0.5, 0.5) });
  }
  return pdf.save();
}

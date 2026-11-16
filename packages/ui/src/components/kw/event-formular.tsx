import * as React from "react";
import { Button } from "../button";
import { Input } from "../input";
import { Label } from "../label";
import { Textarea } from "../textarea";

export type EventFormWerte = {
  name?: string;
  beschreibung?: string;
  datum?: string; // yyyy-MM-ddTHH:mm
  preisEuro?: string;
  kontingent?: number;
  verkaufAb?: string;
  verkaufBis?: string;
  bildUrl?: string | null;
};

/** Formular für das Admin-Backend beider Systeme. `mitVerkauf` blendet den Verkaufszeitraum ein (nur Zielsystem). */
export function EventFormular({
  action,
  werte = {},
  mitVerkauf = false,
  kontingentGesperrt = false,
  fehler,
}: {
  action: (fd: FormData) => void | Promise<void>;
  werte?: EventFormWerte;
  mitVerkauf?: boolean;
  kontingentGesperrt?: boolean;
  fehler?: string;
}) {
  return (
    <form action={action} className="grid gap-5">
      {fehler && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{fehler}</p>}
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required maxLength={200} defaultValue={werte.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="beschreibung">Beschreibung</Label>
        <Textarea id="beschreibung" name="beschreibung" required rows={4} defaultValue={werte.beschreibung} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bild">Bild</Label>
        {werte.bildUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={werte.bildUrl} alt="" className="h-28 w-48 rounded-md object-cover" />
        )}
        <Input id="bild" name="bild" type="file" accept="image/png,image/jpeg,image/webp" />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="datum">Datum</Label>
          <Input id="datum" name="datum" type="datetime-local" required defaultValue={werte.datum} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="preis">Preis (€)</Label>
          <Input id="preis" name="preis" type="number" step="0.01" min="0" required defaultValue={werte.preisEuro} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="kontingent">Anzahl Tickets</Label>
          <Input id="kontingent" name="kontingent" type="number" min="1" max="100000" required defaultValue={werte.kontingent} disabled={kontingentGesperrt} />
          {kontingentGesperrt && <p className="text-xs text-muted-foreground">Gesperrt, weil der Verkauf schon läuft.</p>}
        </div>
      </div>
      {mitVerkauf && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="verkaufAb">Verkauf ab</Label>
            <Input id="verkaufAb" name="verkaufAb" type="datetime-local" required defaultValue={werte.verkaufAb} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="verkaufBis">Verkauf bis</Label>
            <Input id="verkaufBis" name="verkaufBis" type="datetime-local" required defaultValue={werte.verkaufBis} />
          </div>
        </div>
      )}
      <div>
        <Button type="submit">Speichern</Button>
      </div>
    </form>
  );
}

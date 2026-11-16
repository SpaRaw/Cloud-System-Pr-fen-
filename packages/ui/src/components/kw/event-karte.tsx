import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../card";

export type EventKarteDaten = {
  id: string;
  name: string;
  beschreibung: string;
  bildUrl: string | null;
  datumText: string;
  preisText: string;
};

/** Karte für die Eventliste. `verfuegbar` ist ein Slot, damit der neue Shop dort live zählen kann. */
export function EventKarte({ e, verfuegbar, href }: { e: EventKarteDaten; verfuegbar: React.ReactNode; href: string }) {
  return (
    <Card className="pt-0">
      {e.bildUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.bildUrl} alt="" className="aspect-video w-full object-cover" />
      ) : (
        <div className="aspect-video w-full bg-gradient-to-br from-primary/80 to-chart-3/70" />
      )}
      <CardHeader>
        <CardTitle>{e.name}</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" /> {e.datumText}
        </CardDescription>
      </CardHeader>
      <CardContent className="line-clamp-3 text-sm text-muted-foreground">{e.beschreibung}</CardContent>
      <CardFooter className="mt-auto justify-between">
        <span className="font-medium">{e.preisText}</span>
        {verfuegbar}
      </CardFooter>
      <CardFooter>
        <a href={href} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/85">
          Tickets ansehen
        </a>
      </CardFooter>
    </Card>
  );
}

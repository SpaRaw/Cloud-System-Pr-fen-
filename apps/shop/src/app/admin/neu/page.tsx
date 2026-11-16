import { EventFormular } from "@kw/ui/components/kw/event-formular";
import { zuLokal } from "@kw/core/format";
import { eventAnlegen } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default function Neu() {
  const jetzt = new Date();
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-3xl font-bold">Neues Event</h1>
      <EventFormular action={eventAnlegen} mitVerkauf werte={{ kontingent: 500, verkaufAb: zuLokal(jetzt), verkaufBis: zuLokal(new Date(jetzt.getTime() + 30 * 86_400_000)) }} />
    </div>
  );
}

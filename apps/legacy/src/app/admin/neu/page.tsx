import { EventFormular } from "@kw/ui/components/kw/event-formular";
import { eventAnlegen } from "@/lib/admin";

export default function Neu() {
  return (
    <div className="grid max-w-2xl gap-6">
      <h1 className="text-3xl font-bold">Neues Event</h1>
      <EventFormular action={eventAnlegen} werte={{ kontingent: 500 }} />
    </div>
  );
}

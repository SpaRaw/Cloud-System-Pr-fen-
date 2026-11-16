import * as React from "react";
import { TicketIcon } from "lucide-react";

export function SiteHeader({ variante, rechts }: { variante: string; rechts?: React.ReactNode }) {
  return (
    <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <a href="/shop" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <TicketIcon className="size-5 text-primary" />
          KlangWerk Tickets
        </a>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{variante}</span>
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <a href="/shop" className="text-muted-foreground hover:text-foreground">Shop</a>
          <a href="/admin" className="text-muted-foreground hover:text-foreground">Admin</a>
          {rechts}
        </nav>
      </div>
    </header>
  );
}

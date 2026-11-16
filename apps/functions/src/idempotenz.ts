// Lokal: EVENT_ID=<uuid> pnpm --filter @kw/functions idempotenz   (gegen docker compose --profile ziel)
import { closeRedis } from "@kw/core";
import { closeDb } from "@kw/db";
import { idempotenzTest } from "./idempotenz-test";

const eventId = process.env.EVENT_ID;
if (!eventId) throw new Error("EVENT_ID fehlt");
console.log(await idempotenzTest(eventId));
await closeDb();
await closeRedis();

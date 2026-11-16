import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { QueueClient, QueueServiceClient } from "@azure/storage-queue";

// Lokal: STORAGE_CONNECTION_STRING (Azurite).
// Azure: STORAGE_ACCOUNT_NAME + Managed Identity, also kein Schlüssel in der Konfiguration.

export const QUEUE_NAME = process.env.QUEUE_NAME ?? "bestellungen";
export const CONTAINER_TICKETS = "tickets";
export const CONTAINER_BILDER = "bilder";

let blob: BlobServiceClient | undefined;
let queue: QueueClient | undefined;

function credential() {
  return new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID });
}

export function blobService(): BlobServiceClient {
  if (!blob) {
    const cs = process.env.STORAGE_CONNECTION_STRING;
    if (cs) blob = BlobServiceClient.fromConnectionString(cs);
    else {
      const name = process.env.STORAGE_ACCOUNT_NAME;
      if (!name) throw new Error("STORAGE_CONNECTION_STRING oder STORAGE_ACCOUNT_NAME fehlt");
      blob = new BlobServiceClient(`https://${name}.blob.core.windows.net`, credential());
    }
  }
  return blob;
}

export function bestellQueue(): QueueClient {
  if (!queue) {
    const cs = process.env.STORAGE_CONNECTION_STRING;
    if (cs) queue = QueueServiceClient.fromConnectionString(cs).getQueueClient(QUEUE_NAME);
    else {
      const name = process.env.STORAGE_ACCOUNT_NAME;
      if (!name) throw new Error("STORAGE_CONNECTION_STRING oder STORAGE_ACCOUNT_NAME fehlt");
      queue = new QueueClient(`https://${name}.queue.core.windows.net/${QUEUE_NAME}`, credential());
    }
  }
  return queue;
}

const angelegt = new Set<string>();
async function container(name: string): Promise<ContainerClient> {
  const c = blobService().getContainerClient(name);
  if (!angelegt.has(name)) {
    await c.createIfNotExists();
    angelegt.add(name);
  }
  return c;
}

export async function blobHochladen(containerName: string, pfad: string, daten: Buffer | Uint8Array, contentType: string) {
  const c = await container(containerName);
  await c.getBlockBlobClient(pfad).uploadData(daten, { blobHTTPHeaders: { blobContentType: contentType } });
  return pfad;
}

export async function blobLesen(containerName: string, pfad: string): Promise<{ daten: Buffer; contentType: string } | null> {
  const c = await container(containerName);
  const b = c.getBlobClient(pfad);
  if (!(await b.exists())) return null;
  const props = await b.getProperties();
  return { daten: await b.downloadToBuffer(), contentType: props.contentType ?? "application/octet-stream" };
}

/** Functions erwarten Queue-Nachrichten standardmäßig Base64-kodiert. */
export async function inQueueLegen(nachricht: unknown) {
  const q = bestellQueue();
  const text = Buffer.from(JSON.stringify(nachricht)).toString("base64");
  try {
    await q.sendMessage(text);
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 404) {
      await q.createIfNotExists();
      await q.sendMessage(text);
    } else throw e;
  }
}

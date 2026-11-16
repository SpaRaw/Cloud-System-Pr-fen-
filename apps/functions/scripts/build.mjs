// Bündelt die Functions mit allen Workspace-Paketen in dist/, damit das Deployment ohne pnpm-Workspace auskommt.
import { build } from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/azure.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/azure.js",
  sourcemap: true,
  external: ["@azure/functions-core"],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
await writeFile(
  "dist/package.json",
  JSON.stringify({ name: "kw-functions", type: "module", main: "azure.js", dependencies: {} }, null, 2),
);
await cp("host.json", "dist/host.json");
console.log("dist/ gebaut");

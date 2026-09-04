import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await rm(new URL("./dist/", import.meta.url), { recursive: true, force: true });
await build({
  bundle: true,
  entryPoints: [fileURLToPath(new URL("./src/index.ts", import.meta.url))],
  external: ["@fastify/cors", "fastify", "zod"],
  format: "esm",
  legalComments: "none",
  logLevel: "info",
  outfile: fileURLToPath(new URL("./dist/index.js", import.meta.url)),
  platform: "node",
  sourcemap: true,
  target: "node22",
});

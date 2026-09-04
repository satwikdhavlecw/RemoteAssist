import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = new URL("./dist/", import.meta.url);
const srcdir = new URL("./src/", import.meta.url);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(new URL("index.html", srcdir), new URL("index.html", outdir));

const buildContext = await context({
  entryPoints: [fileURLToPath(new URL("main.tsx", srcdir))],
  entryNames: "console",
  outdir: fileURLToPath(outdir),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  legalComments: "none",
  logLevel: "info",
  minify: false,
  sourcemap: true,
  target: "chrome120",
});

if (watch) {
  await buildContext.watch();
  console.log("RemoteAssist support console is watching for changes.");
} else {
  await buildContext.rebuild();
  await buildContext.dispose();
}

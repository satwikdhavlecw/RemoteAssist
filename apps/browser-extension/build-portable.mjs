import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = new URL("./dist/", import.meta.url);
const srcdir = new URL("./src/", import.meta.url);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await Promise.all([
  cp(new URL("manifest.json", srcdir), new URL("manifest.json", outdir)),
  cp(
    new URL("sidepanel/index.html", srcdir),
    new URL("sidepanel.html", outdir),
  ),
  cp(
    new URL("microphone-permission/index.html", srcdir),
    new URL("microphone-permission.html", outdir),
  ),
]);

const builds = [
  {
    entryPoints: [fileURLToPath(new URL("sidepanel/main.tsx", srcdir))],
    entryNames: "sidepanel",
    outdir: fileURLToPath(outdir),
  },
  {
    entryPoints: [fileURLToPath(new URL("background/index.ts", srcdir))],
    entryNames: "background",
    outdir: fileURLToPath(outdir),
  },
  {
    entryPoints: [fileURLToPath(new URL("content/index.ts", srcdir))],
    entryNames: "content",
    outdir: fileURLToPath(outdir),
  },
  {
    entryPoints: [
      fileURLToPath(new URL("microphone-permission/index.ts", srcdir)),
    ],
    entryNames: "microphone-permission",
    outdir: fileURLToPath(outdir),
  },
];

const contexts = await Promise.all(
  builds.map((options) =>
    context({
      ...options,
      bundle: true,
      format: "iife",
      jsx: "automatic",
      legalComments: "none",
      logLevel: "info",
      minify: false,
      sourcemap: true,
      target: "chrome120",
    }),
  ),
);

if (watch) {
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  console.log(
    "RemoteAssist extension is watching for changes in apps/browser-extension/dist",
  );
} else {
  await Promise.all(contexts.map((buildContext) => buildContext.rebuild()));
  await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
}

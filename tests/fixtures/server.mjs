import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.FIXTURE_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.FIXTURE_PORT ?? "4320", 10);
const fixturesDir = fileURLToPath(new URL("./", import.meta.url));
const distDir = fileURLToPath(
  new URL("../../apps/browser-extension/dist/", import.meta.url),
);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host || host + ":" + port}`);
  const pathname = url.pathname;

  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (pathname === "/external-partner") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head><title>External Partner Portal</title></head>
  <body style="font-family: Arial; padding: 30px; background: #fff7ed; text-align: center;">
    <h1 style="color: #9a3412;">External Partner Portal</h1>
    <p style="margin-top: 10px; color: #431407;">You have navigated to a third-party partner identity provider at origin: <strong>${url.origin}</strong>.</p>
    <button id="partner-confirm-btn" type="button" style="margin-top: 20px; padding: 10px 16px; background: #ea580c; color: white; border: none; border-radius: 6px; font-weight: bold;">Confirm Partner Link</button>
  </body>
</html>`);
    return;
  }

  let filePath;
  if (pathname === "/" || pathname === "/salesforce-saml") {
    filePath = join(fixturesDir, "salesforce-saml.html");
  } else if (pathname === "/sap-po-invoice" || pathname === "/sap-po-invoice.html") {
    filePath = join(fixturesDir, "sap-po-invoice.html");
  } else if (pathname === "/verify" || pathname === "/verify.html") {
    filePath = join(fixturesDir, "verify.html");
  } else if (pathname.startsWith("/dist/")) {
    filePath = join(distDir, pathname.replace(/^\/dist\//, ""));
  } else {
    filePath = join(fixturesDir, pathname.replace(/^\//, ""));
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("File not found");
  }
}).listen(port, host, () => {
  console.log(
    `RemoteAssist fixture server running at http://${host}:${port}/salesforce-saml and http://${host}:${port}/verify.html`,
  );
});

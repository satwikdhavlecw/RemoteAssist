import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.SUPPORT_CONSOLE_PORT ?? 4330);
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/console.js": ["console.js", "text/javascript; charset=utf-8"],
  "/console.css": ["console.css", "text/css; charset=utf-8"],
  "/console.js.map": ["console.js.map", "application/json; charset=utf-8"],
};

createServer(async (request, response) => {
  try {
    const [file, contentType] = files[request.url ?? "/"] ?? files["/"];
    const body = await readFile(new URL(`./dist/${file}`, import.meta.url));
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Support console asset not found. Run npm run build first.");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`RemoteAssist support console: http://127.0.0.1:${port}`);
});

# RemoteAssist - Third-Party Libraries Guide (Simple English)

This guide explains all the libraries and software tools used in the **RemoteAssist** project. It is written in simple, non-technical English for anyone who is not familiar with JavaScript (JS) or Node.js.

---

## 1. Web Application & Server Libraries

### Fastify (`fastify`)

- **What it is**: A fast, lightweight web server framework.
- **What it does in this project**: It powers our API backend server (`services/api`). It listens for requests sent by the browser extension (like "start session", "submit page summary", "propose command"), processes them, and returns replies.
- **Where it is used**:
  - [`services/api/src/app.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/app.ts) (Initializes and configures the server instance).
  - [`services/api/src/routes/`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/routes/) (Directory containing all the server path endpoints, like `/v1/support-sessions`).
- **How it works in the code**:
  It starts the server listening on a port:
  ```typescript
  const app = fastify();
  await app.listen({ port: 4310 });
  ```

### Fastify CORS (`@fastify/cors`)

- **What it is**: A plugin for Fastify that enables Cross-Origin Resource Sharing (CORS).
- **What it does in this project**: It allows the browser extension (running on a `chrome-extension://` origin) to securely communicate with the backend API server (running on `http://127.0.0.1:4310`).
- **Where it is used**:
  - [`services/api/src/app.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/app.ts)
- **How it works in the code**:
  It is registered as a helper plugin immediately when the server boots:
  ```typescript
  await app.register(fastifyCors, {
    origin: true, // allows the browser extension to connect
  });
  ```

### React (`react` & `react-dom`)

- **What it is**: A user interface (UI) library developed by Meta (Facebook).
- **What it does in this project**: It renders the chat box, state labels, buttons, and "Allow once" proposal cards in the sidebar panel of the extension. It also powers the human operator support dashboard console.
- **Where it is used**:
  - [`apps/browser-extension/src/sidepanel/`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/sidepanel/) (Renders the React panel elements like `App.tsx` and `ControlPanel.tsx`).
  - [`apps/support-console/src/`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/support-console/src/) (Renders the support dashboard).
- **How it works in the code**:
  It dynamically builds UI components based on the active state:
  ```tsx
  const [issue, setIssue] = useState("");
  return <textarea value={issue} onChange={(e) => setIssue(e.target.value)} />;
  ```
  `react-dom` then mounts this component hierarchy onto the main HTML template (`index.html`) using:
  ```typescript
  createRoot(document.getElementById("root")).render(<App />);
  ```

---

## 2. Validation & Security Libraries

### Zod (`zod`)

- **What it is**: A tool used to validate that data matches a specific layout or rules.
- **What it does in this project**: It sits at the gate of our server routes and extension executor. When data comes from the browser page or LLM (such as a proposed action payload), Zod checks that it contains the correct text format, role lengths, and matching types, and rejects anything else.
- **Where it is used**:
  - [`packages/command-schema/src/index.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/packages/command-schema/src/index.ts) (Defines structure layouts for commands and execution outcomes).
  - [`services/api/src/routes/`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/routes/) (Validates payload structure on POST endpoints).
- **How it works in the code**:
  We define a schema layout and run `parse` on inputs:
  ```typescript
  const schema = z.object({ query: z.string().min(1) });
  const validatedData = schema.parse(request.body); // throws error if not a string
  ```

---

## 3. Development & Build Tools

### TypeScript (`typescript`)

- **What it is**: A stricter version of JavaScript. It requires you to define the _type_ of every variable (e.g., this variable must always be a text string, that one must always be a number).
- **What it does in this project**: The entire project is written in TypeScript.
- **Where it is used**:
  - Configured in the root [`tsconfig.json`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/tsconfig.json) and workspace-specific configuration files (like [`services/api/tsconfig.json`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/tsconfig.json)).
- **How it works in the code**:
  It enforces static contract type checks when writing code:
  ```typescript
  function isTerminalStatus(status: SessionStatus): boolean { ... }
  ```

### TSX (`tsx`)

- **What it is**: A runner that lets you run TypeScript files directly in Node.js without compiling them first.
- **What it does in this project**: When you run `npm run dev:api`, TSX loads and starts the API backend server immediately. It also watches the files for changes and automatically restarts the server if you edit the code.
- **Where it is used**:
  - [`services/api/package.json`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/package.json) (under the `"dev"` run script).
- **How it works in the code**:
  Runs the server code on the fly in development:
  ```json
  "dev": "node --env-file=../../.env --import tsx --watch src/index.ts"
  ```

### ESBuild (`esbuild`)

- **What it is**: An extremely fast bundle compiler.
- **What it does in this project**: It takes all the separate TypeScript code files of the React sidebar and compiles them into a single, optimized JavaScript file (`dist/sidepanel.js`) that the browser extension can load.
- **Where it is used**:
  - [`apps/browser-extension/build-portable.mjs`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/build-portable.mjs) (The compilation build file).
- **How it works in the code**:
  Triggers a build process that gathers files, resolves paths, and outputs a bundle file:
  ```javascript
  import esbuild from "esbuild";
  await esbuild.build({
    entryPoints: ["src/index.tsx"],
    outfile: "dist/sidepanel.js",
    bundle: true,
  });
  ```

---

## 4. Testing Libraries

### Vitest (`vitest`)

- **What it is**: A modern, high-speed test runner.
- **What it does in this project**: It runs all our unit tests (like checking if the fuzzy matching works, or if safety gates successfully block bad URLs).
- **Where it is used**:
  - Configured in the root [`package.json`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/package.json) under test scripts, and all files ending in `.test.ts` or `.test.tsx` (like [`services/api/tests/control.test.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/tests/control.test.ts)).
- **How it works in the code**:
  Asserts expectations in test cases:
  ```typescript
  it("computes a transition", () => {
    expect(canTransitionSession("RESOLVED", "TROUBLESHOOTING")).toBe(true);
  });
  ```

### JSDOM (`jsdom`)

- **What it is**: A simulated web browser DOM (Document Object Model) written entirely in JavaScript.
- **What it does in this project**: It lets us test the browser extension's UI components and page element clicker inside our terminal commands, without having to open a real browser window (Chrome or Edge) every time we run tests.
- **Where it is used**:
  - Configured as the testing environment in [`apps/browser-extension/vitest.config.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/vitest.config.ts).
- **How it works in the code**:
  Injects browser variables (like `document`, `window`, and `HTMLElement`) into the Node test runtime so browser-specific code can be loaded and tested in a CLI environment.

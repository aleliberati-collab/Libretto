// Build di Libretto: compila src/app.jsx in app.js e rigenera sw.js con una nuova versione.
// Uso: npm install && npm run build
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

await build({
  entryPoints: ["src/app.jsx"],
  outfile: "app.js",
  loader: { ".jsx": "jsx" },
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  target: ["chrome90", "safari14"],
  minify: true,
  legalComments: "none",
  logLevel: "info",
});

// la versione dipende dal contenuto: cambia solo se cambia davvero qualcosa
const hash = createHash("sha256");
for (const f of ["index.html", "style.css", "app.js", "manifest.webmanifest", "fonts/manrope.woff2"]) hash.update(readFileSync(f));
const version = hash.digest("hex").slice(0, 12);
writeFileSync("sw.js", readFileSync("sw.js.template", "utf8").replace("__VERSION__", version));
console.log("sw.js versione", version);

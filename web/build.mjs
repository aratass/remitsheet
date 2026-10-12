// Bundles the web app into docs/ (served by GitHub Pages from the main branch /docs folder).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}docs`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [`${root}web/src/main.ts`],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome110", "firefox110", "safari16"],
  outfile: `${out}/app.js`,
  legalComments: "none",
  logLevel: "info",
});
cpSync(`${root}web/index.html`, `${out}/index.html`);
cpSync(`${root}web/styles.css`, `${out}/styles.css`);
cpSync(`${root}web/public`, out, { recursive: true });
if (existsSync(`${root}submission/cover-1280x720.png`)) cpSync(`${root}submission/cover-1280x720.png`, `${out}/cover.png`);
console.log("built docs/");

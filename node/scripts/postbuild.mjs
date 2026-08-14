// The package is ESM by default ("type": "module"), so the CommonJS build needs
// its own package.json to stop Node from interpreting dist/cjs/*.js as ESM.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

writeFileSync(
  resolve(pkgRoot, "dist/cjs/package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

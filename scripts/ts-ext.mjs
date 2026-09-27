import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Node's type strip does not resolve extensionless "./file" imports to "./file.ts". */
export function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.(ts|tsx|js|mjs|cjs|json|css)$/.test(specifier)
  ) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}

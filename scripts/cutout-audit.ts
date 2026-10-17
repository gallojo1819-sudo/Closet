/**
 * Read-only audit of the stored cut-outs in a closet_meta export.
 *
 *   node --experimental-strip-types scripts/cutout-audit.ts [path]
 *
 * Reads the file at `path` (default: the Oct 14 2026 export kept outside the repo, see
 * DEFAULT_EXPORT_PATH in src/lib/cutout-audit.ts), prints how many active pieces hold a
 * cut-out, how many of those never went through the single-garment check (all of them before
 * Oct 16 2026) or were checked with a no or unclear verdict, and lists each one as
 * "needs re-check". No network, no env, nothing written: closet.v6 and closet_meta are untouched.
 */
import { readFileSync } from "node:fs";
import { auditCutouts, DEFAULT_EXPORT_PATH, formatAudit } from "../src/lib/cutout-audit.ts";

const path = process.argv[2] ?? DEFAULT_EXPORT_PATH;
const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
process.stdout.write(`${formatAudit(path, auditCutouts(parsed))}\n`);

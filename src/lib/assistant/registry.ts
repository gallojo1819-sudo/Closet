/**
 * The assistant's tool registry. A tool is a named, zod-typed, risk-labelled function over
 * one AssistantCtx (the user's own pieces and the page). The registry is capped at 15 tools,
 * every name starts with "closet_", and runTool never throws: an unknown tool, bad args, an id
 * that is not in the closet, or a tool that would write all come back as { ok: false, error }.
 * In this round only "read" tools run; anything else answers "needs approval". Pure: no React,
 * no store, no network, no server runtime, nothing persisted.
 */
import { z } from "zod";
import type { Garment, Look } from "../types.ts";
import type { TasteMemory } from "../taste.ts";
import type { StylistPageContext } from "../stylist-page.ts";
import type { NotesBackend } from "../stylist-notes/notes.ts";
import type { TodayLookState } from "../today-look.ts";
import type { Rotation } from "../rotation.ts";

export const MAX_TOOLS = 15;
export const TOOL_PREFIX = "closet_";
export const NEEDS_APPROVAL = "needs approval";
export const NOT_OWNED = "That piece is not in this closet.";

export type ToolRisk = "read" | "write" | "delete";

export type ToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** What every tool reads. The pool is the user's live pieces; nothing here is written. */
export type AssistantCtx = {
  pool: Garment[];
  taste: TasteMemory;
  page: StylistPageContext;
  /** A measured reading only. Absent means unmeasured; no tool fetches one. */
  weatherF?: number;
  notes: NotesBackend;
  today: TodayLookState;
  /** The day as YYYY-MM-DD. Tests pin it; live it is todayISO(). */
  date?: string;
  /** Looks already shown (Lookbook rows, the week row) for "not shown lately". */
  looks?: Look[];
  /** The session's Re-dress rotation, when the caller has one. */
  rotation?: Rotation;
};

export type ToolDef<A = unknown, R = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<A>;
  risk: ToolRisk;
  run(ctx: AssistantCtx, args: A): R | Promise<R>;
};

export type Registry = {
  readonly list: readonly ToolDef[];
  readonly byName: ReadonlyMap<string, ToolDef>;
};

/** The shape native function calling takes: a name, a description and a JSON schema. */
export type ModelTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export function defineRegistry(tools: readonly ToolDef<any, any>[]): Registry {
  if (tools.length > MAX_TOOLS) {
    throw new Error(`A registry holds at most ${MAX_TOOLS} tools; got ${tools.length}.`);
  }
  const byName = new Map<string, ToolDef>();
  for (const tool of tools) {
    if (!tool.name.startsWith(TOOL_PREFIX)) {
      throw new Error(`Tool name must start with "${TOOL_PREFIX}": ${tool.name}`);
    }
    if (byName.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool as ToolDef);
  }
  return { list: [...byName.values()], byName };
}

export function toModelTools(registry: Registry): ModelTool[] {
  return registry.list.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema) as Record<string, unknown>,
  }));
}

const ID_SHAPE = /^g_[a-z0-9]+$/;

/** Every garment-shaped id anywhere in the parsed args, so no tool can be handed a stranger's piece. */
export function idsInArgs(args: unknown, out: string[] = []): string[] {
  if (typeof args === "string") {
    if (ID_SHAPE.test(args)) out.push(args);
  } else if (Array.isArray(args)) {
    for (const item of args) idsInArgs(item, out);
  } else if (args && typeof args === "object") {
    for (const value of Object.values(args as Record<string, unknown>)) idsInArgs(value, out);
  }
  return out;
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export async function runTool(
  registry: Registry,
  ctx: AssistantCtx,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = registry.byName.get(name);
  if (!tool) {
    const known = registry.list.map((t) => t.name).join(", ");
    return { ok: false, error: `Unknown tool "${name}". Use one of: ${known}.` };
  }
  if (tool.risk !== "read") return { ok: false, error: NEEDS_APPROVAL };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Fix the arguments for ${name}: ${issueText(parsed.error)}` };
  }
  const owned = new Set(ctx.pool.map((g) => g.id));
  if (idsInArgs(parsed.data).some((id) => !owned.has(id))) return { ok: false, error: NOT_OWNED };
  try {
    const data = await tool.run(ctx, parsed.data);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `${name} could not answer: ${message}` };
  }
}

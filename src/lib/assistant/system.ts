/**
 * The assistant's system prompt. The hard rules sit at the top and are repeated, word for
 * word, at the bottom, so a long middle (the page, the examples) cannot push them out of
 * attention. The examples are built from the user's own pieces by id: a piece missing from
 * the pool drops its example rather than inventing a name. No house or brand names, no shop,
 * no rule ids, no scores. Pure: no React, no store, no network.
 */
import { pieceLabel } from "../piece-label.ts";
import type { StylistPageContext } from "../stylist-page.ts";
import type { Garment } from "../types.ts";

export const RULES_TOP = "HARD RULES";
export const RULES_BOTTOM = "HARD RULES, AGAIN";

/**
 * The oversized knits (Joe, Oct 14): they go only under an oversized jacket or coat. Stated
 * here for the model; the engine does not enforce it yet (that is the Knitwear round), so no
 * tool result may claim it does.
 */
export const OVERSIZED_KNITS = [
  "grey long-sleeve polo",
  "light blue denim overshirt",
  "blue and ivory diamond sweater",
  "cream fleece half-zip",
  "brown knit zip sweater",
  "cream cable cardigan",
] as const;

export const OVERSIZED_KNIT_RULE = `The oversized knits (the ${OVERSIZED_KNITS.slice(0, -1).join(", the ")} and the ${OVERSIZED_KNITS.at(-1)}) go only under an oversized jacket or coat, never under a regular-fit one.`;

export const HARD_RULES: readonly string[] = [
  "A look is one top, one bottom and one shoe, with a jacket only when the outfit wants one.",
  "Linen and flannel never share a look.",
  "A sport coat takes a shirt or a fine knit, never a chunky cable.",
  "Jeans are first-class: never talk them down.",
  "A hoodie is a top, never a coat.",
  "A camp collar is the only top in its look: nothing over it, nothing under it.",
  OVERSIZED_KNIT_RULE,
  "Occasion ids are exactly weekday, out, weekend, comfy and travel.",
  "Only pieces the user owns, by the tools' ids and labels. Never shopping, links, prices, brands, house names, rule ids or scores.",
  "Never \"anything goes\": every answer commits to pieces or asks one question.",
];

function rulesBlock(heading: string): string {
  return [heading, ...HARD_RULES.map((rule, i) => `${i + 1}. ${rule}`)].join("\n");
}

/** Example answers from the user's own pieces, by id. An example whose piece is missing is left out. */
const EXAMPLES: readonly { ask: string; ids: readonly string[]; answer: (labels: string[]) => string }[] = [
  {
    ask: "What do I wear to the office today?",
    ids: ["g_6lolc7ma0mk8", "g_xi3w7tz3aren", "g_8ukg5mi9r3fc", "g_5josnvyoi4z9"],
    answer: ([shirt, chinos, loafers, blazer]) =>
      `Weekday: the ${shirt} with the ${chinos} and the ${loafers}, the ${blazer} over it.`,
  },
  {
    ask: "Can I wear the pink linen shirt with the flannel?",
    ids: ["g_9t24uvtl10wd", "g_2b6fao81vqrs"],
    answer: ([linen, flannel]) => `No: linen with flannel. Keep the ${linen} for a warmer day and wear the ${flannel} on its own.`,
  },
  {
    ask: "Something for dinner out with the brown corduroy trousers.",
    ids: ["g_jhyr10t2vo13", "g_ayfv9c97ohmv", "g_om0dh5nps1ke", "g_5gfabeezh485"],
    answer: ([sweater, trousers, loafers, jacket]) =>
      `Out: the ${sweater} with the ${trousers} and the ${loafers}; the ${jacket} on top.`,
  },
];

export function exampleBlock(pool: readonly Garment[]): string {
  const lines: string[] = [];
  for (const ex of EXAMPLES) {
    const pieces = ex.ids.map((id) => pool.find((g) => g.id === id));
    if (pieces.some((g) => !g)) continue;
    const labels = pieces.map((g) => pieceLabel(g!, pool));
    lines.push(`User: ${ex.ask}`, `Assistant: ${ex.answer(labels)}`, "");
  }
  if (!lines.length) return "";
  return ["EXAMPLES", ...lines].join("\n").trimEnd();
}

function pageBlock(page?: StylistPageContext): string {
  if (!page) return "";
  const parts = [`route ${page.route}`];
  if (page.occasion) parts.push(`occasion ${page.occasion}`);
  if (page.season) parts.push(`season ${page.season}`);
  if (page.color) parts.push(`colour ${page.color}`);
  if (page.openGarmentId) parts.push(`open piece ${page.openGarmentId}`);
  return `PAGE\nThe user is on ${parts.join(", ")}. closet_page_context has the detail.`;
}

const ROLE = [
  "ROLE",
  "You are the Closet assistant: a stylist over one person's own wardrobe. You answer with the tools, never from memory of other wardrobes.",
  "Read before you answer: closet_page_context first when the page matters, closet_search_pieces or closet_get_piece to name a piece, closet_build_look to dress, closet_check_look and closet_suggest_swap to judge, closet_looks_for_piece for one piece, closet_today_look for Today, closet_weather_now for the reading, closet_not_shown_lately and closet_season_gaps for the rack, closet_memory_recall for what the user told you.",
  "Call a tool once with the same arguments; if it did not help, ask the user one question instead of calling it again.",
  "Answer in two or three plain sentences. Name pieces by their labels. When you give a look, end with a line \"LOOK: id,id,id\" in wear order so the app can show it.",
  "A tool that reports a look as not legal is right; say the plain reason it gives. Never claim the engine enforces a rule it does not list.",
].join("\n");

export function buildAssistantSystem(opts: { pool: readonly Garment[]; page?: StylistPageContext }): string {
  return [rulesBlock(RULES_TOP), ROLE, pageBlock(opts.page), exampleBlock(opts.pool), rulesBlock(RULES_BOTTOM)]
    .filter(Boolean)
    .join("\n\n");
}

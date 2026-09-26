/**
 * Copy one tagged camera piece onto garments_v2.
 * closet_meta stays the UI source. A failed mirror does not undo that save.
 * Does not retag or rewrite the rest of the rack.
 */

export type GarmentV2Fields = {
  legacyId: string;
  name: string;
  category: string;
  subcategory: string;
  colors: string[];
  fabric: string;
  brand: string;
};

export type GarmentV2Write = {
  error: { message?: string } | null;
  /** Rows touched. 0 means this legacy id is not in the table yet. */
  updated: number;
};

export type GarmentV2Writer = {
  updateOne: (userId: string, legacyId: string, fields: Omit<GarmentV2Fields, "legacyId">) => Promise<GarmentV2Write>;
  insertOne?: (userId: string, fields: GarmentV2Fields) => Promise<{ error: { message?: string } | null }>;
};

export function garmentV2Fields(input: {
  id: string;
  name: string;
  category: string;
  subtype?: string;
  colors?: string[];
  material?: string;
  brand?: string;
}): GarmentV2Fields {
  return {
    legacyId: input.id,
    name: input.name,
    category: input.category,
    subcategory: input.subtype ?? "",
    colors: [...(input.colors ?? [])],
    fabric: input.material ?? "",
    brand: input.brand ?? "",
  };
}

/**
 * Update that legacy_id only. Insert only when the row is missing.
 * Throws are caught by the caller. Returns false when nothing was written.
 */
type V2Client = {
  from: (table: "garments_v2") => {
    update: (row: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          select: (columns: string) => PromiseLike<{
            data: { legacy_id: string }[] | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    insert: (row: Record<string, unknown>) => PromiseLike<{
      error: { message?: string } | null;
    }>;
  };
};

/** One row. Never a table-wide retag. */
export function garmentWriter(sb: V2Client | null): GarmentV2Writer | null {
  if (!sb) return null;
  return {
    updateOne: async (userId, legacyId, fields) => {
      const { data, error } = await sb
        .from("garments_v2")
        .update({
          name: fields.name,
          category: fields.category,
          subcategory: fields.subcategory,
          colors: fields.colors,
          fabric: fields.fabric,
          brand: fields.brand,
        })
        .eq("user_id", userId)
        .eq("legacy_id", legacyId)
        .select("legacy_id");
      return { error, updated: data?.length ?? 0 };
    },
    insertOne: async (userId, fields) => {
      const { error } = await sb.from("garments_v2").insert({
        user_id: userId,
        legacy_id: fields.legacyId,
        status: "in_closet",
        name: fields.name,
        category: fields.category,
        subcategory: fields.subcategory,
        colors: fields.colors,
        fabric: fields.fabric,
        brand: fields.brand,
      });
      return { error };
    },
  };
}

export async function mirrorGarmentFields(
  writer: GarmentV2Writer | null,
  userId: string | null,
  fields: GarmentV2Fields,
): Promise<boolean> {
  if (!writer || !userId || !fields.legacyId) return false;
  try {
    const { legacyId, ...rest } = fields;
    const updated = await writer.updateOne(userId, legacyId, rest);
    if (updated.error) return false;
    if (updated.updated > 0) return true;
    if (!writer.insertOne) return false;
    const inserted = await writer.insertOne(userId, fields);
    return !inserted.error;
  } catch {
    return false;
  }
}

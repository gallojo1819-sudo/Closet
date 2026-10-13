/**
 * The stylist_notes policies, run for real. PGlite (Postgres in WASM, already a dependency)
 * gets a stub of what Supabase provides — the auth schema, auth.users, auth.uid() read from
 * the request claim, the anon and authenticated roles — and then the migration file verbatim.
 * Two users, and every statement the app makes, as each of them and as anon.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

const SUPABASE_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
`;

let db: PGlite;

async function as(user: string | null, role: "authenticated" | "anon" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ""}', false); set role ${role};`);
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function fails(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await db.query(sql, params);
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

describe("stylist_notes row-level security", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STUB);
    const sql = readFileSync(new URL("../../../supabase/migrations/20261013200000_stylist_notes.sql", import.meta.url), "utf8");
    await db.exec(sql);
    /* Idempotent: the file runs twice without error. */
    await db.exec(sql);
    await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
  });

  afterAll(async () => {
    await db.close();
  });

  it("a user inserts and reads only their own notes", async () => {
    await as(A);
    const [mine] = await rows<{ id: string; kind: string }>(
      "insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, $2, 'never', 'loafers', 'stated') returning id, kind",
      [A, "Never loafers"],
    );
    expect(mine?.kind).toBe("never");
    const forged = await fails(
      "insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'x', 'never', 'x', 'stated')",
      [B],
    );
    expect(forged).toMatch(/row-level security/);

    await as(B);
    await rows("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'I lean navy', 'lean', 'navy', 'stated')", [B]);
    const seenByB = await rows<{ text: string }>("select text from public.stylist_notes order by created_at");
    expect(seenByB.map((r) => r.text)).toEqual(["I lean navy"]);

    await as(A);
    const seenByA = await rows<{ text: string }>("select text from public.stylist_notes order by created_at");
    expect(seenByA.map((r) => r.text)).toEqual(["Never loafers"]);
  });

  it("delete and supersede reach only the owner's rows, and only the superseded columns move", async () => {
    await as(A);
    const [a1] = await rows<{ id: string }>("select id from public.stylist_notes where user_id = $1", [A]);
    await as(B);
    const [b1] = await rows<{ id: string }>("select id from public.stylist_notes where user_id = $1", [B]);
    expect(a1?.id).toBeTruthy();
    expect(b1?.id).toBeTruthy();

    /* B cannot delete or supersede A's note: the statement touches no row. */
    const deleted = await rows("delete from public.stylist_notes where id = $1 returning id", [a1!.id]);
    expect(deleted).toEqual([]);
    const moved = await rows("update public.stylist_notes set superseded_at = now(), superseded_by = $2 where id = $1 returning id", [a1!.id, b1!.id]);
    expect(moved).toEqual([]);

    /* A cannot rewrite the note's words or kind: no column grant. */
    await as(A);
    expect(await fails("update public.stylist_notes set text = 'changed' where id = $1", [a1!.id])).toMatch(/permission denied/);
    expect(await fails("update public.stylist_notes set kind = 'lean' where id = $1", [a1!.id])).toMatch(/permission denied/);
    expect(await fails("update public.stylist_notes set topic = 'x' where id = $1", [a1!.id])).toMatch(/permission denied/);

    /* A supersedes their own note with a newer one and the older row stays. */
    const [a2] = await rows<{ id: string }>(
      "insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'Loafers are fine again', 'lean', 'loafers', 'stated') returning id",
      [A],
    );
    const superseded = await rows<{ id: string }>(
      "update public.stylist_notes set superseded_at = now(), superseded_by = $1 where topic = 'loafers' and id <> $1 and superseded_at is null returning id",
      [a2!.id],
    );
    expect(superseded.map((r) => r.id)).toEqual([a1!.id]);
    const active = await rows<{ id: string }>("select id from public.stylist_notes where superseded_at is null");
    expect(active.map((r) => r.id)).toEqual([a2!.id]);
    const kept = await rows<{ id: string; superseded_by: string }>("select id, superseded_by from public.stylist_notes where id = $1", [a1!.id]);
    expect(kept[0]?.superseded_by).toBe(a2!.id);

    /* A deletes their own note. */
    const gone = await rows("delete from public.stylist_notes where id = $1 returning id", [a2!.id]);
    expect(gone.length).toBe(1);
    const after = await rows<{ superseded_by: string | null; superseded_at: string | null }>(
      "select superseded_by, superseded_at from public.stylist_notes where id = $1",
      [a1!.id],
    );
    expect(after[0]?.superseded_by).toBeNull();
    expect(after[0]?.superseded_at).not.toBeNull();
  });

  it("anon and a signed-out session get nothing", async () => {
    await as(null, "anon");
    expect(await fails("select id from public.stylist_notes")).toMatch(/permission denied/);
    expect(await fails("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'x', 'never', 'x', 'stated')", [A])).toMatch(
      /permission denied/,
    );
    await as(null, "authenticated");
    expect(await rows("select id from public.stylist_notes")).toEqual([]);
    expect(await fails("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'x', 'never', 'x', 'stated')", [A])).toMatch(
      /row-level security/,
    );
  });

  it("the checks hold the shape", async () => {
    await as(A);
    expect(await fails("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'x', 'maybe', 'x', 'stated')", [A])).toMatch(/check/);
    expect(await fails("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, 'x', 'never', 'x', 'guess')", [A])).toMatch(/check/);
    expect(await fails("insert into public.stylist_notes (user_id, text, kind, topic, source) values ($1, '', 'never', 'x', 'stated')", [A])).toMatch(/check/);
    const [row] = await rows<{ id: string }>("select id from public.stylist_notes where user_id = $1 limit 1", [A]);
    expect(await fails("update public.stylist_notes set superseded_by = $1, superseded_at = null where id = $1", [row!.id])).toMatch(/check/);
  });
});

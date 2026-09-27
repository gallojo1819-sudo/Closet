import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redirectToFromLocation } from "./client.ts";

describe("oauth redirect", () => {
  it("returns to the current host and path, not production", () => {
    const redirect = redirectToFromLocation({
      origin: "https://closet-git-cursor-stop-closet-data-loss-3cae-joeybats.vercel.app",
      pathname: "/lookbook",
      search: "?look=1",
    });
    assert.equal(
      redirect,
      "https://closet-git-cursor-stop-closet-data-loss-3cae-joeybats.vercel.app/lookbook?look=1",
    );
    assert.equal(redirect.includes("closet-ten-hazel.vercel.app"), false);
  });
});

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redirectToFromLocation } from "./client.ts";

describe("oauth redirect", () => {
  it("returns to the current host and path, not production", () => {
    const redirect = redirectToFromLocation({
      origin: "https://closet-git-cursor-stop-closet-data-loss-3cae-joeybats.vercel.app",
      pathname: "/lookbook",
      search: "?look=1&code=abc&state=xyz&error=access_denied&error_description=no",
    });
    assert.equal(
      redirect,
      "https://closet-git-cursor-stop-closet-data-loss-3cae-joeybats.vercel.app/lookbook?look=1",
    );
    assert.equal(redirect.includes("closet-ten-hazel.vercel.app"), false);
    assert.equal(redirect.includes("code="), false);
  });

  it("Google and Apple both pass authRedirectTo()", () => {
    const src = readFileSync(new URL("./account.ts", import.meta.url), "utf8");
    const google = src.slice(src.indexOf("function signInWithGoogle"), src.indexOf("function sendMagicLink"));
    const apple = src.slice(src.indexOf("function signInWithApple"), src.indexOf("function signInWithGoogle"));
    assert.match(google, /redirectTo:\s*authRedirectTo\(\)/);
    assert.match(apple, /redirectTo:\s*authRedirectTo\(\)/);
  });
});

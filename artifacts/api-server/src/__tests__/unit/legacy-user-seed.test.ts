import { describe, expect, it } from "vitest";
import {
  getLegacyMappingMode,
  matchVerifiedEmail,
  parseLegacySeed,
} from "../../lib/legacy-user-seed";

describe("legacy user mapping helpers", () => {
  it("is off unless LEGACY_USER_MAPPING=email", () => {
    expect(getLegacyMappingMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(getLegacyMappingMode({ LEGACY_USER_MAPPING: "yes" } as NodeJS.ProcessEnv)).toBe("off");
    expect(getLegacyMappingMode({ LEGACY_USER_MAPPING: " Email " } as NodeJS.ProcessEnv)).toBe("email");
  });

  it("parses the seed, lowercases emails, and skips bad or duplicate entries", () => {
    const seed = parseLegacySeed(
      JSON.stringify([
        { email: "Liv@Example.com", legacyUserId: "user_old1" },
        { email: "liv@example.com", legacyUserId: "user_old2" },
        { email: "other@example.com", legacyUserId: "user_old1" },
        { email: "", legacyUserId: "user_x" },
        { email: "b@example.com" },
        { email: "c@example.com", legacyUserId: "user_old3" },
      ]),
    );
    expect([...seed.entries()]).toEqual([
      ["liv@example.com", "user_old1"],
      ["c@example.com", "user_old3"],
    ]);
  });

  it("returns an empty map for missing or invalid seed", () => {
    expect(parseLegacySeed(undefined).size).toBe(0);
    expect(parseLegacySeed("not json").size).toBe(0);
    expect(parseLegacySeed('{"email":"a"}').size).toBe(0);
  });

  it("matches only verified emails, case-insensitively", () => {
    const seed = parseLegacySeed(JSON.stringify([{ email: "liv@example.com", legacyUserId: "user_old1" }]));
    expect(matchVerifiedEmail([{ emailAddress: "LIV@example.com", verified: false }], seed)).toBeNull();
    expect(matchVerifiedEmail([{ emailAddress: "LIV@example.com", verified: true }], seed)).toBe("user_old1");
    expect(matchVerifiedEmail([{ emailAddress: "nobody@example.com", verified: true }], seed)).toBeNull();
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { validateClientToken } from "../src/client-auth.js";

const validToken = "074ea9558210e4dddedf4d74ceff55b662e9ba7b6bebe99f29c95028db56001a";

test("accepts the exact configured Android client credential", () => {
  assert.equal(validateClientToken(validToken, validToken), true);
});

test("rejects incorrect, missing, malformed and short credentials", () => {
  assert.equal(validateClientToken("f".repeat(64), validToken), false);
  assert.equal(validateClientToken("", validToken), false);
  assert.equal(validateClientToken(undefined, validToken), false);
  assert.equal(validateClientToken("abc123", validToken), false);
  assert.equal(validateClientToken(validToken, ""), false);
});

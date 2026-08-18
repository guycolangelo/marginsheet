// AES-GCM for Plaid access tokens (4.2.2).
//
// WHAT THIS FILE CANNOT PROVE, stated first so nothing here is mistaken for it:
// every test below supplies its OWN key. That proves the algorithm and says
// NOTHING about the value in the secret store. Malformed, truncated and
// wrong-length keys all pass a round trip against a key the test generated
// itself. The deployed round trip using the key sync actually holds is the
// other half, and it lives in sync's /debug/crypto-selftest.

import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../src/token-crypto.js";

const key = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const TOKEN = "access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6";

// base64url helpers for the tamper tests. PADDING IS COMPUTED, not assumed.
// The first version appended a literal "==" and the iv case threw
// InvalidCharacterError: a 12 byte iv encodes to 16 characters, already a
// multiple of 4. The ciphertext case passed only because its length happened
// to need exactly two. A helper that works by luck of input length is the
// fixture-fragility class in miniature, so it is computed here.
const unb64url = (t: string) =>
  Uint8Array.from(
    atob(t.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (t.length % 4)) % 4)),
    (c) => c.charCodeAt(0)
  );
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** Flips one bit of a base64url segment, which is what tag verification must reject. */
const flipByte = (segment: string) => {
  const bytes = unb64url(segment);
  bytes[0] ^= 0x01;
  return b64url(bytes);
};

describe("the round trip", () => {
  it("returns exactly what went in", async () => {
    const k = key();
    expect(await decryptToken(await encryptToken(TOKEN, k), k)).toBe(TOKEN);
  });

  it("produces a different ciphertext every time, so the iv is not reused", async () => {
    const k = key();
    const a = await encryptToken(TOKEN, k);
    const b = await encryptToken(TOKEN, k);
    expect(a).not.toBe(b);
    // Both still decrypt, so the difference is the iv and not corruption.
    expect(await decryptToken(a, k)).toBe(await decryptToken(b, k));
  });

  it("carries a version, so a stored ciphertext can say which scheme made it", async () => {
    expect((await encryptToken(TOKEN, key())).startsWith("v1.")).toBe(true);
  });
});

describe("decryption FAILS rather than returning garbage", () => {
  it("rejects a wrong key", async () => {
    const encrypted = await encryptToken(TOKEN, key());
    await expect(decryptToken(encrypted, key())).rejects.toThrow(/wrong key or tampered/);
  });

  // THE TEST THAT PROVES THE TAG IS ACTUALLY VERIFIED (Guy, 17 Aug 2026).
  //
  // A wrong-key rejection alone does not prove it: a wrong key could be
  // rejected for reasons unrelated to authentication. Flipping ONE BYTE of
  // ciphertext and decrypting with the CORRECT key is rejected by NOTHING BUT
  // tag verification. If the tag were not being checked, this returns
  // corrupted bytes and the assertion fails.
  it("rejects a single flipped byte of ciphertext, under the correct key", async () => {
    const k = key();
    const [version, iv, ct] = (await encryptToken(TOKEN, k)).split(".");
    await expect(decryptToken(`${version}.${iv}.${flipByte(ct)}`, k)).rejects.toThrow(/wrong key or tampered/);
  });

  it("rejects a flipped byte of the iv, under the correct key", async () => {
    const k = key();
    const [version, iv, ct] = (await encryptToken(TOKEN, k)).split(".");
    await expect(decryptToken(`${version}.${flipByte(iv)}.${ct}`, k)).rejects.toThrow(/wrong key or tampered/);
  });

  it("does not leak which of wrong-key or tampered it was", async () => {
    // Telling them apart tells an attacker which one they got right.
    const k = key();
    const encrypted = await encryptToken(TOKEN, k);
    const wrongKey = await decryptToken(encrypted, key()).catch((e) => e.message);
    const [v, iv, ct] = encrypted.split(".");
    const tampered = await decryptToken(`${v}.${iv}.${flipByte(ct)}`, k).catch((e) => e.message);
    expect(wrongKey).toBe(tampered);
  });
});

describe("a malformed key is refused, because the secret store does not validate", () => {
  it("rejects a key that is not 32 bytes, naming the length and not the value", async () => {
    const short = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    await expect(encryptToken(TOKEN, short)).rejects.toThrow(/must decode to 32 bytes, got 16/);
  });

  it("rejects a key that is not base64", async () => {
    await expect(encryptToken(TOKEN, "not base64 at all!!")).rejects.toThrow(/not valid base64/);
  });

  it("rejects an empty key, which is what the 15 Aug incident put in six stores", async () => {
    await expect(encryptToken(TOKEN, "")).rejects.toThrow(/must decode to 32 bytes, got 0/);
  });
});

describe("malformed ciphertext is refused", () => {
  it("rejects a value with the wrong shape", async () => {
    await expect(decryptToken("not-a-ciphertext", key())).rejects.toThrow(/expected format/);
  });

  it("rejects an unknown version, so a future scheme is not silently misread", async () => {
    const k = key();
    const [, iv, ct] = (await encryptToken(TOKEN, k)).split(".");
    await expect(decryptToken(`v2.${iv}.${ct}`, k)).rejects.toThrow(/unknown ciphertext version v2/);
  });
});

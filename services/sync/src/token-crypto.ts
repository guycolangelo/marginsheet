// AES-GCM for Plaid access tokens (M4 task 4.2.2).
//
// LIVES HERE AND NOT IN packages/shared, DELIBERATELY. Only the sync Worker may
// decrypt, so only the sync Worker gets the code. Putting it in shared would
// make it importable by api and conversation, and the third-Worker ruling would
// then rest on nobody happening to import it. A boundary that depends on
// restraint is not a boundary.
//
// FORMAT: v1.<base64url iv>.<base64url ciphertext+tag>
//
// The version prefix exists because key rotation is a real operation for this
// system: rotating today means re-linking Items, and after 4.5b it means
// re-linking a household's real banks. A stored ciphertext that cannot say
// which scheme produced it cannot be migrated without guessing.

const VERSION = "v1";
const IV_BYTES = 12; // 96 bits, the size AES-GCM is specified for
const KEY_BYTES = 32; // AES-256

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Imports the configured key, REJECTING one that is the wrong length.
 *
 * A truncated or malformed key is the failure this whole module exists to
 * survive: it would otherwise sit in the secret store looking present while
 * every encrypt silently produced something no future deploy could read. The
 * length is checked here rather than trusted, because the value arrives from a
 * secret store and nothing else validates it. */
async function importKey(keyMaterial: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(keyMaterial), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("TOKEN_ENCRYPTION_KEY is not valid base64");
  }
  if (raw.length !== KEY_BYTES) {
    // Says the length it found and never any part of the value.
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${raw.length}`
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToken(plaintext: string, keyMaterial: string): Promise<string> {
  const key = await importKey(keyMaterial);
  // A fresh IV per encryption. Reusing one under the same key breaks AES-GCM
  // catastrophically rather than gradually.
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    )
  );
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(ciphertext)}`;
}

/** Decrypts, or THROWS. Never returns a partial or unauthenticated result.
 *
 * AES-GCM verifies its authentication tag before returning any plaintext, so a
 * wrong key, a tampered ciphertext or a tampered IV all raise rather than
 * yielding garbage. That property is what stops a caller treating rubbish as an
 * access token, and it is asserted by test rather than assumed: the test that
 * proves the tag is checked flips ONE BYTE OF CIPHERTEXT and decrypts with the
 * CORRECT key, which nothing but tag verification rejects. */
export async function decryptToken(encoded: string, keyMaterial: string): Promise<string> {
  const parts = encoded.split(".");
  if (parts.length !== 3) throw new Error("ciphertext is not in the expected format");
  const [version, ivPart, ctPart] = parts;
  if (version !== VERSION) throw new Error(`unknown ciphertext version ${version}`);

  const key = await importKey(keyMaterial);
  const iv = b64urlDecode(ivPart);
  if (iv.length !== IV_BYTES) throw new Error("ciphertext carries a malformed iv");

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64urlDecode(ctPart));
  } catch {
    // WebCrypto throws an OperationError with no detail for a tag failure, and
    // that is correct: distinguishing "wrong key" from "tampered" would tell an
    // attacker which one they got right.
    throw new Error("decryption failed: wrong key or tampered ciphertext");
  }
  return new TextDecoder().decode(plaintext);
}

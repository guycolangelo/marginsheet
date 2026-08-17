// A real software authenticator for WebAuthn tests.
//
// WHY THIS IS NOT A MOCK, and why that distinction is the whole point.
//
// The plan flagged the risk that testing passkeys in CI would tempt a stubbed
// authenticator. A stub asserts that our own function was called, which is a
// test that cannot fail. Guy's ruling: bring the finding rather than ship one,
// and take a named gap with an owner over a green test that proves nothing.
//
// No gap was needed. This generates a real P-256 keypair, builds real
// authenticator data, and signs real ECDSA assertions. The server verifies
// those signatures with @simplewebauthn/server, the same code that verifies a
// YubiKey or a phone. If the signature is wrong, registration and login fail.
//
// What it does NOT reproduce: hardware attestation (it uses the "none"
// attestation format, which is what platform authenticators send anyway), user
// presence hardware, and the browser's origin enforcement. Origin and
// challenge are supplied here and checked by the server, so those paths are
// exercised; the physical gesture is not, and cannot be.

import { createSign, generateKeyPairSync, createHash, randomBytes } from "node:crypto";

// Built on Uint8Array and DataView rather than Buffer, deliberately.
// @cloudflare/workers-types declares both a global Buffer and the node:buffer
// module, and its toString() takes no encoding argument, so every
// `.toString("base64url")` fails to typecheck in this package no matter how
// the import is aliased. Rather than fight the type resolution order, this
// uses only APIs that exist identically in Node and in workerd.

const bytes = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const b64url = (b: Uint8Array): string => {
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const u16 = (n: number): Uint8Array => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n);
  return b;
};

const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// Minimal CBOR encoder, covering exactly the shapes WebAuthn needs.
// Hand-written rather than pulled from a dependency's internals: the structure
// is fixed and tiny, and a test helper that depends on undocumented internals
// breaks on a patch release.
// ---------------------------------------------------------------------------

function cborHead(major: number, length: number): Uint8Array {
  if (length < 24) return Uint8Array.from([(major << 5) | length]);
  if (length < 256) return Uint8Array.from([(major << 5) | 24, length]);
  if (length < 65536) return bytes(Uint8Array.from([(major << 5) | 25]), u16(length));
  return bytes(Uint8Array.from([(major << 5) | 26]), u32(length));
}

const cborBytes = (b: Uint8Array) => bytes(cborHead(2, b.length), b);
const cborText = (s: string) => {
  const e = utf8(s);
  return bytes(cborHead(3, e.length), e);
};
// CBOR negative integers encode -1-n, which is how COSE labels like -7 appear.
const cborInt = (n: number) => (n < 0 ? cborHead(1, -1 - n) : cborHead(0, n));
const cborMap = (entries: Array<[Uint8Array, Uint8Array]>) =>
  bytes(cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [k, v]));

// ---------------------------------------------------------------------------
// The authenticator
// ---------------------------------------------------------------------------

export interface AuthenticatorOptions {
  /** The relying party id, e.g. "localhost". Hashed into authenticator data. */
  rpId: string;
  /** The origin the "browser" claims, e.g. "http://localhost:8787". */
  origin: string;
}

export class SoftwareAuthenticator {
  readonly credentialId: Uint8Array;
  private readonly privateKey;
  private readonly publicKey;
  private counter = 0;

  constructor(private readonly opts: AuthenticatorOptions) {
    this.credentialId = new Uint8Array(randomBytes(32));
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  /** COSE_Key for an ES256 public key: kty EC2, alg ES256, crv P-256, x, y. */
  private cosePublicKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    return cborMap([
      [cborInt(1), cborInt(2)], // kty: EC2
      [cborInt(3), cborInt(-7)], // alg: ES256
      [cborInt(-1), cborInt(1)], // crv: P-256
      [cborInt(-2), cborBytes(fromB64url(jwk.x))],
      [cborInt(-3), cborBytes(fromB64url(jwk.y))],
    ]);
  }

  private authData(includeCredential: boolean): Uint8Array {
    const rpIdHash = new Uint8Array(createHash("sha256").update(this.opts.rpId).digest());
    // UP (user present) | UV (user verified) | AT (attested credential data)
    const flags = Uint8Array.from([includeCredential ? 0x45 : 0x05]);
    const counter = u32(++this.counter);
    if (!includeCredential) return bytes(rpIdHash, flags, counter);

    const aaguid = new Uint8Array(16); // all zeros, as platform authenticators send
    return bytes(
      rpIdHash,
      flags,
      counter,
      aaguid,
      u16(this.credentialId.length),
      this.credentialId,
      this.cosePublicKey()
    );
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Uint8Array {
    return utf8(
      JSON.stringify({ type, challenge, origin: this.opts.origin, crossOrigin: false })
    );
  }

  /** The response a browser returns from navigator.credentials.create(). */
  register(challenge: string) {
    const clientDataJSON = this.clientData("webauthn.create", challenge);
    const attestationObject = cborMap([
      [cborText("fmt"), cborText("none")],
      [cborText("attStmt"), cborMap([])],
      [cborText("authData"), cborBytes(this.authData(true))],
    ]);

    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key" as const,
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** The response a browser returns from navigator.credentials.get(). */
  authenticate(challenge: string) {
    const clientDataJSON = this.clientData("webauthn.get", challenge);
    const authenticatorData = this.authData(false);

    // The real signature: ECDSA over authenticatorData || SHA256(clientDataJSON).
    // Get this wrong and the server rejects it, which is what makes this a test
    // rather than a stub.
    const clientDataHash = new Uint8Array(
      createHash("sha256").update(clientDataJSON).digest()
    );
    const signature = new Uint8Array(
      createSign("SHA256").update(bytes(authenticatorData, clientDataHash)).sign(this.privateKey)
    );

    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key" as const,
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        userHandle: undefined,
      },
    };
  }

  /** Corrupts the next signature, to prove the server actually verifies it. */
  forgeBadSignature(challenge: string) {
    const good = this.authenticate(challenge);
    const bad = fromB64url(good.response.signature);
    bad[bad.length - 1] ^= 0xff;
    return { ...good, response: { ...good.response, signature: b64url(bad) } };
  }
}

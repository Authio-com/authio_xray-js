const DEFAULT_PROOF_TTL_SECONDS = 300;

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlToBuffer(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface MintVisitorProofOptions {
  visitorId: string;
  projectId: string;
  signingKey: string;
  ttlSeconds?: number;
}

export async function mintVisitorProof(
  options: MintVisitorProofOptions,
): Promise<string> {
  const {
    visitorId,
    projectId,
    signingKey,
    ttlSeconds = DEFAULT_PROOF_TTL_SECONDS,
  } = options;

  if (!visitorId || !projectId || !signingKey) {
    throw new Error("visitorId, projectId, and signingKey are required");
  }

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadJson = JSON.stringify({
    visitor_id: visitorId,
    project_id: projectId,
    exp,
  });

  const encoder = new TextEncoder();
  const payloadB64 = bufferToBase64Url(encoder.encode(payloadJson));

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadB64),
  );

  const signatureB64 = bufferToBase64Url(signature);
  return `xvp_${payloadB64}.${signatureB64}`;
}

export function parseVisitorProof(
  token: string,
): { visitorId: string; projectId: string; exp: number } | null {
  const prefixed = token.startsWith("xvp_") ? token.slice(4) : token;
  const dotIndex = prefixed.indexOf(".");
  if (dotIndex < 1) return null;

  const payloadB64 = prefixed.slice(0, dotIndex);
  try {
    const payloadBytes = base64UrlToBuffer(payloadB64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      visitor_id?: string;
      project_id?: string;
      exp?: number;
    };
    if (!payload.visitor_id || !payload.project_id || !payload.exp) {
      return null;
    }
    return {
      visitorId: payload.visitor_id,
      projectId: payload.project_id,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export async function verifyVisitorProof(
  token: string,
  signingKey: string,
): Promise<boolean> {
  const prefixed = token.startsWith("xvp_") ? token.slice(4) : token;
  const dotIndex = prefixed.indexOf(".");
  if (dotIndex < 1) return false;

  const payloadB64 = prefixed.slice(0, dotIndex);
  const signatureB64 = prefixed.slice(dotIndex + 1);

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signatureBytes = base64UrlToBuffer(signatureB64);
  const valid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as unknown as ArrayBuffer,
    encoder.encode(payloadB64),
  );

  if (!valid) return false;

  const parsed = parseVisitorProof(token);
  if (!parsed) return false;

  return parsed.exp >= Math.floor(Date.now() / 1000);
}

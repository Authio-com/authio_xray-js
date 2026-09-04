import { mintVisitorProof } from "./proof";

export interface WithXRayOptions {
  projectId: string;
  proofSigningKey: string;
  visitorIdCookie?: string;
  proofHeader?: string;
  proofTtlSeconds?: number;
}

export function withXRay(options: WithXRayOptions) {
  const {
    projectId,
    proofSigningKey,
    visitorIdCookie = "authio_xray_visitor",
    proofHeader = "x-xray-visitor-proof",
    proofTtlSeconds,
  } = options;

  return async function middleware(
    request: { cookies: { get(name: string): { value: string } | undefined } },
    response?: {
      headers: { set(name: string, value: string): void };
    },
  ): Promise<{ headers: { set(name: string, value: string): void } } | null> {
    const visitorId = request.cookies.get(visitorIdCookie)?.value;
    if (!visitorId) return response ?? null;

    const proof = await mintVisitorProof({
      visitorId,
      projectId,
      signingKey: proofSigningKey,
      ttlSeconds: proofTtlSeconds,
    });

    if (response) {
      response.headers.set(proofHeader, proof);
      return response;
    }

    return {
      headers: {
        set(_name: string, _value: string) {
          /* caller constructs response */
        },
      },
    };
  };
}

export async function getServerSideProof(options: {
  visitorId: string;
  projectId: string;
  proofSigningKey: string;
  ttlSeconds?: number;
}): Promise<string> {
  return mintVisitorProof({
    visitorId: options.visitorId,
    projectId: options.projectId,
    signingKey: options.proofSigningKey,
    ttlSeconds: options.ttlSeconds,
  });
}

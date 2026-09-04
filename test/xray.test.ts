import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XRayCollector } from "../src/client";

const COLLECTOR_KEY = "xrk_test_1234567890123456";
const CONSENT = {
  granted: true as const,
  receiptReference: "consent-receipt-1",
  purposes: ["analytics", "account_intent"] as const,
  grantedAt: "2026-09-04T17:25:00.000Z",
};

function response(status: number): Response {
  return { status } as Response;
}

function eventBody(fetcher: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetcher.mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    events: Array<Record<string, unknown>>;
  };
}

describe("XRayCollector", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not access storage or send telemetry before consent", () => {
    const fetcher = vi.fn();
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
    });

    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/pricing",
      }),
    ).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    client.destroy();
  });

  it("rotates visitor and session IDs after consent withdrawal", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      flushIntervalMs: 60_000,
    });

    client.track({
      type: "page_viewed",
      url: "https://example.com/docs",
    });
    await client.flush();
    const first = eventBody(fetcher).events[0]!;

    client.setConsent({ granted: false });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    client.setConsent({ ...CONSENT, receiptReference: "consent-receipt-2" });
    client.track({
      type: "page_viewed",
      url: "https://example.com/pricing",
    });
    await client.flush();
    const second = eventBody(fetcher, 1).events[0]!;

    expect(first.visitor_id).toMatch(/^xv_[A-Za-z0-9_-]{16,}$/);
    expect(first.session_id).toMatch(/^xs_[A-Za-z0-9_-]{16,}$/);
    expect(second.visitor_id).not.toBe(first.visitor_id);
    expect(second.session_id).not.toBe(first.session_id);
    client.destroy();
  });

  it("honors Global Privacy Control over an explicit consent grant", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    const fetcher = vi.fn();
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
    });

    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/",
      }),
    ).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    client.destroy();
  });

  it("clears existing IDs when GPC is enabled before pagehide", () => {
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: vi.fn(),
      initialConsent: CONSENT,
    });
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(1);

    Object.defineProperty(navigator, "globalPrivacyControl", {
      value: true,
      configurable: true,
    });
    dispatchEvent(new PageTransitionEvent("pagehide"));

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    client.destroy();
  });

  it("fails closed for invalid or analytics-only consent", () => {
    const fetcher = vi.fn();
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
    });

    expect(() =>
      client.setConsent({
        granted: true,
        receiptReference: "",
        purposes: ["account_intent"],
      }),
    ).not.toThrow();
    client.setConsent({
      granted: true,
      receiptReference: "analytics-only",
      purposes: ["analytics"],
    });
    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/pricing",
      }),
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    client.destroy();
  });

  it("drops sensitive paths and strips non-allowlisted URL data", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(204));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      includeTitle: true,
      flushIntervalMs: 60_000,
    });

    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/auth/callback?code=secret",
      }),
    ).toBe(false);
    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/%256dedical/records",
      }),
    ).toBe(false);
    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/finance/invoices",
      }),
    ).toBe(false);

    expect(
      client.track({
        type: "page_viewed",
        url: "https://example.com/pricing?utm_source=search&email=private%40example.com&gclid=secret#details",
        referrer: "https://search.example/results?q=private",
        title: "Pricing",
      }),
    ).toBe(true);
    await client.flush();

    const body = eventBody(fetcher);
    expect(body.events).toHaveLength(1);
    const payload = body.events[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      origin: "https://example.com",
      pathname: "/pricing",
      referrer_origin: "https://search.example",
      referrer_pathname: "/results",
      title: "Pricing",
      attribution: {
        utm_source: "search",
        click_id_type: "gclid",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("secret");
    client.destroy();
  });

  it("rejects untrusted API and beacon endpoints", () => {
    expect(
      () =>
        new XRayCollector({
          collectorKey: COLLECTOR_KEY,
          fetch: vi.fn(),
          identifyEndpoint: "https://evil.example/identify",
        }),
    ).toThrow("identifyEndpoint must be an HTTPS Authio endpoint");
    expect(
      () =>
        new XRayCollector({
          collectorKey: COLLECTOR_KEY,
          fetch: vi.fn(),
          beaconEndpoint: "https://evil.example/collect",
        }),
    ).toThrow("beaconEndpoint must be same-origin HTTPS");
  });

  it("omits attribution when the URL has no attribution fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      flushIntervalMs: 60_000,
    });
    client.track({
      type: "page_viewed",
      url: "https://example.com/docs",
    });
    await client.flush();

    const payload = eventBody(fetcher).events[0]?.payload as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("attribution");
    client.destroy();
  });

  it("caps batches at twenty events", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      batchSize: 100,
      flushIntervalMs: 60_000,
    });

    for (let index = 0; index < 21; index += 1) {
      client.track({
        type: "page_viewed",
        url: `https://example.com/docs/${index}`,
      });
    }
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    expect(eventBody(fetcher, 0).events).toHaveLength(20);
    expect(eventBody(fetcher, 1).events).toHaveLength(1);
    client.destroy();
  });

  it("does not let an old in-flight flush remove new events", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      batchSize: 1,
    });

    client.track({
      type: "page_viewed",
      url: "https://example.com/old",
    });
    client.setConsent({ granted: false });
    client.setConsent({ ...CONSENT, receiptReference: "new-consent" });
    client.track({
      type: "page_viewed",
      url: "https://example.com/new",
    });
    resolveFirst?.(response(202));

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const payload = eventBody(fetcher, 1).events[0]?.payload as Record<
      string,
      unknown
    >;
    expect(payload.pathname).toBe("/new");
    client.destroy();
  });

  it("retries transient collection failures", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
      batchSize: 1,
      retryBaseMs: 100,
    });

    client.track({
      type: "page_viewed",
      url: "https://example.com/docs",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  it("sends only the frozen identify request fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(202));
    const client = new XRayCollector({
      collectorKey: COLLECTOR_KEY,
      fetch: fetcher,
      initialConsent: CONSENT,
    });
    const visitorProof = "proof_12345678901234567890123456789012";

    await expect(
      client.identifyAuthenticatedSession({
        accessToken: "access-token",
        visitorProof,
      }),
    ).resolves.toBe(true);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.authio.com/v1/identify");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({
      visitor_proof: visitorProof,
      consent_receipt_reference: "consent-receipt-1",
    });
    client.destroy();
  });
});

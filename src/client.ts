import { buildEmailPayload, buildPagePayload } from "./privacy";
import { mintVisitorProof as mintProof } from "./proof";
import type {
  ConsentGrant,
  ConsentPurpose,
  ConsentUpdate,
  IdentifyAuthenticatedSessionInput,
  TrackInput,
  XRayClient,
  XRayCollectEvent,
  XRayConfig,
  XRayConsentContext,
} from "./types";

const COLLECTOR_KEY_PATTERN = /^xrk_(?:live|test)_[A-Za-z0-9_-]{16,}$/;
const DEFAULT_COLLECT_ENDPOINT = "https://api.authio.com/v1/collect";
const DEFAULT_IDENTIFY_ENDPOINT = "https://api.authio.com/v1/identify";

interface Identifiers {
  visitorId: string;
  sessionId: string;
}

function projectNamespace(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function randomId(prefix: "evt" | "xv" | "xs"): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}_${value}`;
}

function isGlobalPrivacyControlEnabled(): boolean {
  return (
    (
      globalThis.navigator as Navigator & {
        globalPrivacyControl?: boolean;
      }
    )?.globalPrivacyControl === true
  );
}

function authioEndpoint(value: string, name: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.hostname !== "authio.com" && !url.hostname.endsWith(".authio.com"))
  ) {
    throw new Error(`${name} must be an HTTPS Authio endpoint`);
  }
  return url.href;
}

function sameOriginBeaconEndpoint(value: string): string {
  if (!globalThis.location?.href) {
    throw new Error("beaconEndpoint requires a browser location");
  }
  const url = new URL(value, globalThis.location.href);
  if (
    url.protocol !== "https:" ||
    url.origin !== globalThis.location.origin ||
    url.username ||
    url.password
  ) {
    throw new Error("beaconEndpoint must be same-origin HTTPS");
  }
  return url.href;
}

function asISOString(value: string | Date | undefined): string | null {
  const date = value === undefined ? new Date() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedPurposes(
  purposes: readonly ConsentPurpose[] | undefined,
): ConsentPurpose[] {
  const source: readonly ConsentPurpose[] = purposes ?? ["account_intent"];
  return Array.from(new Set<ConsentPurpose>(source)).slice(0, 2);
}

export class XRayCollector implements XRayClient {
  private readonly config: Required<
    Pick<
      XRayConfig,
      | "collectEndpoint"
      | "identifyEndpoint"
      | "includeTitle"
      | "batchSize"
      | "flushIntervalMs"
      | "retryBaseMs"
      | "retryMaxMs"
    >
  > &
    XRayConfig;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly namespace: string;
  private readonly visitorStorageKey: string;
  private readonly sessionStorageKey: string;
  private consent: XRayConsentContext | null = null;
  private identifiers: Identifiers | null = null;
  private identifiersInitialized = false;
  private queue: XRayCollectEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimerDelay: number | null = null;
  private activeFlush: Promise<boolean> | null = null;
  private activeController: AbortController | null = null;
  private readonly identifyControllers = new Set<AbortController>();
  private retryAttempt = 0;
  private removeConsentProvider: (() => void) | undefined;
  private destroyed = false;

  private readonly pageHideHandler = () => {
    if (isGlobalPrivacyControlEnabled()) {
      this.withdrawConsent(true);
      return;
    }
    if (!this.consent || this.queue.length === 0) return;
    if (this.activeFlush) return;
    if (this.config.beaconEndpoint && globalThis.navigator?.sendBeacon) {
      const events = this.queue.slice(0, this.config.batchSize);
      const body = new Blob([JSON.stringify({ events })], {
        type: "application/json",
      });
      if (globalThis.navigator.sendBeacon(this.config.beaconEndpoint, body)) {
        this.removeEvents(events);
        return;
      }
    }
    void this.flush();
  };

  constructor(config: XRayConfig) {
    if (!COLLECTOR_KEY_PATTERN.test(config.collectorKey)) {
      throw new Error("collectorKey must be a valid xrk_live_* or xrk_test_* key");
    }
    if (!globalThis.crypto?.getRandomValues) {
      throw new Error("Web Crypto is required");
    }

    const fetcher = config.fetch ?? globalThis.fetch;
    if (!fetcher) throw new Error("fetch is required");
    this.fetcher = fetcher.bind(globalThis);
    const collectEndpoint = authioEndpoint(
      config.collectEndpoint ?? DEFAULT_COLLECT_ENDPOINT,
      "collectEndpoint",
    );
    const identifyEndpoint = authioEndpoint(
      config.identifyEndpoint ?? DEFAULT_IDENTIFY_ENDPOINT,
      "identifyEndpoint",
    );
    this.config = {
      ...config,
      collectEndpoint,
      identifyEndpoint,
      ...(config.beaconEndpoint
        ? { beaconEndpoint: sameOriginBeaconEndpoint(config.beaconEndpoint) }
        : {}),
      includeTitle: config.includeTitle ?? false,
      batchSize: Math.min(20, Math.max(1, config.batchSize ?? 20)),
      flushIntervalMs: Math.max(0, config.flushIntervalMs ?? 5_000),
      retryBaseMs: Math.max(100, config.retryBaseMs ?? 1_000),
      retryMaxMs: Math.max(1_000, config.retryMaxMs ?? 30_000),
    };
    this.namespace = projectNamespace(config.collectorKey);
    this.visitorStorageKey = `authio_xray_visitor_${this.namespace}`;
    this.sessionStorageKey = `authio_xray_session_${this.namespace}`;

    try {
      if (config.consentProvider) {
        const removeConsentProvider = config.consentProvider((consent) =>
          this.setConsent(consent),
        );
        this.removeConsentProvider =
          typeof removeConsentProvider === "function"
            ? removeConsentProvider
            : undefined;
      }
      if (isGlobalPrivacyControlEnabled()) {
        this.withdrawConsent(true);
      } else if (config.initialConsent) {
        this.setConsent(config.initialConsent);
      }
    } catch (error) {
      this.withdrawConsent(true);
      this.removeConsentProvider?.();
      throw error;
    }
    globalThis.addEventListener?.("pagehide", this.pageHideHandler);
  }

  setConsent(update: ConsentUpdate): void {
    if (this.destroyed) return;
    if (!update.granted || isGlobalPrivacyControlEnabled()) {
      this.withdrawConsent(true);
      return;
    }
    this.grantConsent(update);
  }

  track(input: TrackInput): boolean {
    if (
      this.destroyed ||
      !this.consent ||
      isGlobalPrivacyControlEnabled()
    ) {
      if (isGlobalPrivacyControlEnabled()) this.withdrawConsent(true);
      return false;
    }

    const occurredAt = asISOString(input.occurredAt);
    if (!occurredAt) return false;
    const identifiers = this.ensureIdentifiers();
    const base = {
      event_id: randomId("evt"),
      occurred_at: occurredAt,
      visitor_id: identifiers.visitorId,
      session_id: identifiers.sessionId,
      consent: this.consent,
    };

    let event: XRayCollectEvent;
    if (input.type === "page_viewed") {
      const payload = buildPagePayload({
        url: input.url ?? globalThis.location?.href ?? "",
        referrer: input.referrer ?? globalThis.document?.referrer ?? null,
        title: input.title ?? globalThis.document?.title,
        campaignToken: input.campaignToken,
        includeTitle: this.config.includeTitle,
        exclusions: this.config.excludedPaths ?? [],
      });
      if (!payload) return false;
      event = {
        ...base,
        event_type: "xray.page_viewed.v1",
        payload,
      };
    } else {
      const payload = buildEmailPayload({
        destinationUrl:
          input.destinationUrl ?? globalThis.location?.href ?? "",
        campaignToken: input.campaignToken,
        scannerSuspected: input.scannerSuspected ?? false,
        exclusions: this.config.excludedPaths ?? [],
      });
      if (!payload) return false;
      event = {
        ...base,
        event_type: "xray.email_clicked.v1",
        payload,
      };
    }

    this.queue.push(event);
    if (this.activeFlush) {
      return true;
    }
    if (this.queue.length >= this.config.batchSize) {
      void this.flush();
    } else {
      this.scheduleFlush(this.config.flushIntervalMs);
    }
    return true;
  }

  async mintVisitorProof(): Promise<string> {
    if (this.destroyed || !this.consent) {
      throw new Error("Cannot mint proof: client not ready");
    }
    const identifiers = this.ensureIdentifiers();
    const signingKey =
      this.config.proofSigningKey ?? this.config.collectorKey;
    return mintProof({
      visitorId: identifiers.visitorId,
      projectId: this.config.projectId,
      signingKey,
      ttlSeconds: this.config.proofTtlSeconds,
    });
  }

  async identifyAuthenticatedSession(
    input: IdentifyAuthenticatedSessionInput,
  ): Promise<boolean> {
    if (
      this.destroyed ||
      !this.consent ||
      isGlobalPrivacyControlEnabled() ||

      !input.accessToken
    ) {
      if (isGlobalPrivacyControlEnabled()) this.withdrawConsent(true);
      return false;
    }

    let xrayVisitorProof: string;
    try {
      xrayVisitorProof = await this.mintVisitorProof();
    } catch {
      return false;
    }

    const consentReceipt = this.consent?.receipt_reference;
    if (!consentReceipt) return false;

    const controller = new AbortController();
    this.identifyControllers.add(controller);
    try {
      const response = await this.fetcher(this.config.identifyEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          xray_visitor_proof: xrayVisitorProof,
          consent_receipt_reference: consentReceipt,
        }),
        keepalive: true,
        signal: controller.signal,
      });
      if (isGlobalPrivacyControlEnabled()) {
        this.withdrawConsent(true);
        return false;
      }
      return (
        !this.destroyed &&
        this.consent?.receipt_reference === consentReceipt &&
        (response.status === 202 || response.status === 204)
      );
    } catch {
      return false;
    } finally {
      this.identifyControllers.delete(controller);
    }
  }

  flush(): Promise<boolean> {
    if (this.activeFlush) return this.activeFlush;
    if (this.destroyed || !this.consent || this.queue.length === 0) {
      return Promise.resolve(false);
    }
    if (isGlobalPrivacyControlEnabled()) {
      this.withdrawConsent(true);
      return Promise.resolve(false);
    }

    const events = this.queue.slice(0, this.config.batchSize);
    this.clearTimer();
    this.activeFlush = this.send(events).finally(() => {
      this.activeFlush = null;
    });
    return this.activeFlush;
  }

  reset(): void {
    if (this.destroyed) return;
    this.queue = [];
    this.clearTimer();
    this.activeController?.abort();
    for (const controller of this.identifyControllers) controller.abort();
    this.clearIdentifiers();
    if (this.consent && !isGlobalPrivacyControlEnabled()) {
      this.ensureIdentifiers();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue = [];
    this.clearTimer();
    this.activeController?.abort();
    this.clearIdentifiers();
    this.consent = null;
    this.removeConsentProvider?.();
    globalThis.removeEventListener?.("pagehide", this.pageHideHandler);
  }

  private grantConsent(grant: ConsentGrant): void {
    const receiptReference = grant.receiptReference.trim();
    const purposes = normalizedPurposes(grant.purposes);
    const grantedAt = asISOString(grant.grantedAt);
    if (
      receiptReference.length < 1 ||
      receiptReference.length > 128 ||
      purposes.length < 1 ||
      !purposes.includes("account_intent") ||
      !grantedAt
    ) {
      this.withdrawConsent(true);
      return;
    }
    this.consent = {
      receipt_reference: receiptReference,
      purposes,
      granted_at: grantedAt,
    };
    this.ensureIdentifiers();
  }

  private withdrawConsent(clearStoredIdentifiers = false): void {
    this.consent = null;
    this.queue = [];
    this.clearTimer();
    this.activeController?.abort();
    for (const controller of this.identifyControllers) controller.abort();
    this.clearIdentifiers(clearStoredIdentifiers);
  }

  private ensureIdentifiers(): Identifiers {
    if (!this.consent) throw new Error("Consent is required");
    if (this.identifiers) return this.identifiers;

    this.identifiersInitialized = true;
    const visitorId = this.readOrCreateId(
      () => globalThis.localStorage,
      this.visitorStorageKey,
      "xv",
    );
    const sessionId = this.readOrCreateId(
      () => globalThis.sessionStorage,
      this.sessionStorageKey,
      "xs",
    );
    this.identifiers = { visitorId, sessionId };
    return this.identifiers;
  }

  private readOrCreateId(
    getStorage: () => Storage | undefined,
    key: string,
    prefix: "xv" | "xs",
  ): string {
    const pattern = new RegExp(`^${prefix}_[A-Za-z0-9_-]{16,}$`);
    try {
      const storage = getStorage();
      const existing = storage?.getItem(key);
      if (existing && pattern.test(existing)) return existing;
      const created = randomId(prefix);
      storage?.setItem(key, created);
      return created;
    } catch {
      return randomId(prefix);
    }
  }

  private clearIdentifiers(force = false): void {
    this.identifiers = null;
    if (!this.identifiersInitialized && !force) return;
    try {
      globalThis.localStorage?.removeItem(this.visitorStorageKey);
    } catch {
      // Storage can be unavailable in privacy modes.
    }
    try {
      globalThis.sessionStorage?.removeItem(this.sessionStorageKey);
    } catch {
      // Storage can be unavailable in privacy modes.
    }
    this.identifiersInitialized = false;
  }

  private async send(events: XRayCollectEvent[]): Promise<boolean> {
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const response = await this.fetcher(this.config.collectEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Authio-XRay-Key": this.config.collectorKey,
        },
        body: JSON.stringify({ events }),
        keepalive: true,
        signal: controller.signal,
      });
      if (response.status === 202 || response.status === 204) {
        this.removeEvents(events);
        this.retryAttempt = 0;
        if (this.queue.length > 0) this.scheduleFlush(0);
        return true;
      }
      if (
        response.status !== 408 &&
        response.status !== 425 &&
        response.status !== 429 &&
        response.status < 500
      ) {
        this.removeEvents(events);
        this.retryAttempt = 0;
        if (this.queue.length > 0) this.scheduleFlush(0);
        return false;
      }
    } catch {
      if (controller.signal.aborted) {
        if (this.queue.length > 0 && this.consent) this.scheduleFlush(0);
        return false;
      }
      // Retry transient network failures below.
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }

    const delay = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * 2 ** this.retryAttempt,
    );
    this.retryAttempt += 1;
    this.scheduleFlush(delay);
    return false;
  }

  private scheduleFlush(delay: number): void {
    if (
      this.destroyed ||
      !this.consent ||
      this.queue.length === 0
    ) {
      return;
    }
    if (
      this.flushTimer &&
      this.flushTimerDelay !== null &&
      this.flushTimerDelay <= delay
    ) {
      return;
    }
    this.clearTimer();
    this.flushTimerDelay = delay;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushTimerDelay = null;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.flushTimerDelay = null;
  }

  private removeEvents(events: XRayCollectEvent[]): void {
    const eventIds = new Set(events.map((event) => event.event_id));
    this.queue = this.queue.filter((event) => !eventIds.has(event.event_id));
  }
}

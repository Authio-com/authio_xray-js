import { XRayCollector } from "./client";
import type {
  ConsentUpdate,
  IdentifyAuthenticatedSessionInput,
  TrackInput,
  XRayClient,
  XRayConfig,
} from "./types";

let defaultClient: XRayClient | null = null;

export function init(config: XRayConfig): XRayClient {
  defaultClient?.destroy();
  defaultClient = new XRayCollector(config);
  return defaultClient;
}

export function setConsent(consent: ConsentUpdate): void {
  defaultClient?.setConsent(consent);
}

export function track(event: TrackInput): boolean {
  return defaultClient?.track(event) ?? false;
}

export function identifyAuthenticatedSession(
  input: IdentifyAuthenticatedSessionInput,
): Promise<boolean> {
  return (
    defaultClient?.identifyAuthenticatedSession(input) ?? Promise.resolve(false)
  );
}

export function flush(): Promise<boolean> {
  return defaultClient?.flush() ?? Promise.resolve(false);
}

export function reset(): void {
  defaultClient?.reset();
}

export { XRayCollector } from "./client";
export {
  createGPPConsentProvider,
  createTCFConsentProvider,
} from "./consent";
export type {
  GPPApi,
  GPPConsentProviderOptions,
  GPPEvent,
  TCFApi,
  TCFData,
  TCFConsentProviderOptions,
} from "./consent";
export type {
  ClickIdType,
  ConsentDenial,
  ConsentGrant,
  ConsentProvider,
  ConsentPurpose,
  ConsentUpdate,
  EmailClickedInput,
  IdentifyAuthenticatedSessionInput,
  PageViewedInput,
  TrackInput,
  XRayAttribution,
  XRayClient,
  XRayCollectEvent,
  XRayCollectRequest,
  XRayConfig,
  XRayConsentContext,
  XRayEmailClickedEvent,
  XRayEmailClickedPayload,
  XRayPageViewedEvent,
  XRayPageViewedPayload,
} from "./types";

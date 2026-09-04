export type ConsentPurpose = "analytics" | "account_intent";

export interface ConsentGrant {
  granted: true;
  receiptReference: string;
  purposes?: readonly ConsentPurpose[];
  grantedAt?: string | Date;
}

export interface ConsentDenial {
  granted: false;
}

export type ConsentUpdate = ConsentGrant | ConsentDenial;
export type ConsentProvider = (
  update: (consent: ConsentUpdate) => void,
) => void | (() => void);

export type ClickIdType =
  | "gclid"
  | "wbraid"
  | "gbraid"
  | "msclkid"
  | "fbclid"
  | "li_fat_id"
  | "ttclid"
  | "twclid"
  | "rdt_cid";

export interface PageViewedInput {
  type: "page_viewed";
  url?: string;
  referrer?: string | null;
  title?: string;
  occurredAt?: string | Date;
  campaignToken?: string;
}

export interface EmailClickedInput {
  type: "email_clicked";
  campaignToken: string;
  destinationUrl?: string;
  scannerSuspected?: boolean;
  occurredAt?: string | Date;
}

export type TrackInput = PageViewedInput | EmailClickedInput;

export interface IdentifyAuthenticatedSessionInput {
  accessToken: string;
  visitorProof: string;
}

export interface XRayConfig {
  collectorKey: string;
  collectEndpoint?: string;
  identifyEndpoint?: string;
  beaconEndpoint?: string;
  consentProvider?: ConsentProvider;
  initialConsent?: ConsentUpdate;
  includeTitle?: boolean;
  batchSize?: number;
  flushIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  excludedPaths?: readonly (string | RegExp)[];
  fetch?: typeof globalThis.fetch;
}

export interface XRayClient {
  setConsent(consent: ConsentUpdate): void;
  track(event: TrackInput): boolean;
  identifyAuthenticatedSession(
    input: IdentifyAuthenticatedSessionInput,
  ): Promise<boolean>;
  flush(): Promise<boolean>;
  reset(): void;
  destroy(): void;
}

export interface XRayConsentContext {
  receipt_reference: string;
  purposes: ConsentPurpose[];
  granted_at: string;
}

export interface XRayAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  click_id_type?: ClickIdType;
}

export interface XRayPageViewedPayload {
  origin: string;
  pathname: string;
  referrer_origin?: string | null;
  referrer_pathname?: string | null;
  title?: string;
  viewport_class: "small" | "medium" | "large" | "extra_large";
  language: string;
  timezone: string;
  attribution?: XRayAttribution;
  campaign_token?: string;
}

export interface XRayEmailClickedPayload {
  campaign_token: string;
  destination_origin: string;
  destination_pathname: string;
  scanner_suspected: boolean;
}

interface XRayEventBase {
  event_id: string;
  occurred_at: string;
  visitor_id: string;
  session_id: string;
  consent: XRayConsentContext;
}

export interface XRayPageViewedEvent extends XRayEventBase {
  event_type: "xray.page_viewed.v1";
  payload: XRayPageViewedPayload;
}

export interface XRayEmailClickedEvent extends XRayEventBase {
  event_type: "xray.email_clicked.v1";
  payload: XRayEmailClickedPayload;
}

export type XRayCollectEvent = XRayPageViewedEvent | XRayEmailClickedEvent;

export interface XRayCollectRequest {
  events: XRayCollectEvent[];
}

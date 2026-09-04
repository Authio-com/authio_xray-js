import type {
  ClickIdType,
  XRayAttribution,
  XRayPageViewedPayload,
} from "./types";

const CLICK_IDS: readonly ClickIdType[] = [
  "gclid",
  "wbraid",
  "gbraid",
  "msclkid",
  "fbclid",
  "li_fat_id",
  "ttclid",
  "twclid",
  "rdt_cid",
];

const DEFAULT_EXCLUSIONS: readonly RegExp[] = [
  /(?:^|\/)(?:auth|authenticate|authentication|oauth|oauth2|sso|login|log-in|sign-in|sign-up)(?:[-/]|$)/i,
  /(?:^|\/)(?:callback|magic-link|verify|token|password|reset-password)(?:[-/]|$)/i,
  /(?:^|\/)(?:health|healthcare|medical|medicine|patients?|diagnosis)(?:[-/]|$)/i,
  /(?:^|\/)(?:finance|financial|billing|payments?|bank|banking)(?:[-/]|$)/i,
];

function truncate(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

function safeDecodedPath(pathname: string): string {
  let decoded = pathname;
  for (let pass = 0; pass < 4; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.replaceAll("_", "-");
}

export function isSensitivePath(
  pathname: string,
  exclusions: readonly (string | RegExp)[] = [],
): boolean {
  const candidates = [pathname.replaceAll("_", "-"), safeDecodedPath(pathname)];
  return [...DEFAULT_EXCLUSIONS, ...exclusions].some((pattern) =>
    candidates.some((candidate) =>
      typeof pattern === "string"
        ? candidate.toLowerCase().startsWith(pattern.toLowerCase())
        : new RegExp(pattern.source, pattern.flags).test(candidate),
    ),
  );
}

export function parsePublicUrl(
  value: string,
  base?: string,
): { url: URL; origin: string; pathname: string } | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const pathname = (`/${url.pathname}`.replace(/\/+/g, "/") || "/").slice(
      0,
      512,
    );
    return {
      url,
      origin: url.origin.slice(0, 255),
      pathname,
    };
  } catch {
    return null;
  }
}

function attributionFrom(url: URL): XRayAttribution | undefined {
  const attribution: XRayAttribution = {};
  const fields = {
    utm_source: 100,
    utm_medium: 100,
    utm_campaign: 150,
    utm_term: 100,
    utm_content: 100,
  } as const;

  for (const [field, maximum] of Object.entries(fields)) {
    const value = url.searchParams.get(field);
    if (value?.trim()) {
      attribution[field as keyof typeof fields] = truncate(value, maximum);
    }
  }

  const clickIdType = CLICK_IDS.find((field) =>
    url.searchParams.has(field),
  );
  if (clickIdType) attribution.click_id_type = clickIdType;
  return Object.keys(attribution).length > 0 ? attribution : undefined;
}

function viewportClass(): XRayPageViewedPayload["viewport_class"] {
  const width = globalThis.innerWidth;
  if (width < 640) return "small";
  if (width < 1024) return "medium";
  if (width < 1440) return "large";
  return "extra_large";
}

export function buildPagePayload(options: {
  url: string;
  referrer?: string | null;
  title?: string;
  campaignToken?: string;
  includeTitle: boolean;
  exclusions: readonly (string | RegExp)[];
}): XRayPageViewedPayload | null {
  const page = parsePublicUrl(options.url, globalThis.location?.href);
  if (!page || isSensitivePath(page.pathname, options.exclusions)) return null;

  const referrer = options.referrer
    ? parsePublicUrl(options.referrer, page.url.href)
    : null;
  const safeReferrer =
    referrer && !isSensitivePath(referrer.pathname, options.exclusions)
      ? referrer
      : null;
  const title =
    options.includeTitle && options.title?.trim()
      ? truncate(options.title, 200)
      : undefined;
  const campaignToken = options.campaignToken?.trim();
  const attribution = attributionFrom(page.url);

  return {
    origin: page.origin,
    pathname: page.pathname,
    referrer_origin: safeReferrer?.origin ?? null,
    referrer_pathname: safeReferrer?.pathname ?? null,
    ...(title ? { title } : {}),
    viewport_class: viewportClass(),
    language: truncate(globalThis.navigator?.language || "und", 35),
    timezone: truncate(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      64,
    ),
    ...(attribution ? { attribution } : {}),
    ...(campaignToken && campaignToken.length >= 16
      ? { campaign_token: campaignToken.slice(0, 512) }
      : {}),
  };
}

export function buildEmailPayload(options: {
  destinationUrl: string;
  campaignToken: string;
  scannerSuspected: boolean;
  exclusions: readonly (string | RegExp)[];
}) {
  const destination = parsePublicUrl(
    options.destinationUrl,
    globalThis.location?.href,
  );
  if (
    !destination ||
    isSensitivePath(destination.pathname, options.exclusions) ||
    options.campaignToken.trim().length < 16
  ) {
    return null;
  }

  return {
    campaign_token: options.campaignToken.trim().slice(0, 512),
    destination_origin: destination.origin,
    destination_pathname: destination.pathname,
    scanner_suspected: options.scannerSuspected,
  };
}

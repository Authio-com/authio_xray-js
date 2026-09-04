# @useauthio/xray

Consent-aware browser collection for Authio XRay account intent. The collector
is framework-neutral, fails closed, and never receives company or account data.

## Install

```sh
pnpm add @useauthio/xray
```

React, Vue, Svelte, and Next.js applications use the same package:

```ts
import {
  init,
  setConsent,
  track,
  identifyAuthenticatedSession,
  reset,
} from "@useauthio/xray";
```

Framework adapters are intentionally unnecessary: this package has no provider,
rendering, or framework lifecycle dependency.

## Initialize and grant consent

Initialization alone does not access storage, create an identifier, inspect
fingerprinting surfaces, or send a request.

```ts
init({
  collectorKey: "xrk_live_replace_with_your_public_key",
  includeTitle: false,
});

setConsent({
  granted: true,
  receiptReference: "your-consent-record-id",
  purposes: ["account_intent"],
  grantedAt: new Date(),
});

track({ type: "page_viewed" });
```

Withdrawing consent stops collection, clears queued events, and deletes the
project-scoped visitor/session IDs. A later grant creates new random IDs.

```ts
setConsent({ granted: false });
```

`navigator.globalPrivacyControl === true` always overrides a grant.

## Generic CMP callback

Pass a subscriber that reports consent changes. Return an unsubscribe function
when the CMP supports one.

```ts
init({
  collectorKey: "xrk_live_replace_with_your_public_key",
  consentProvider(update) {
    return cmp.onConsentChanged((record) => {
      update(
        record.accountIntent
          ? {
              granted: true,
              receiptReference: record.id,
              purposes: ["account_intent"],
              grantedAt: record.createdAt,
            }
          : { granted: false },
      );
    });
  },
});
```

TCF 2.3 and GPP adapters are also exported:

```ts
import {
  createGPPConsentProvider,
  createTCFConsentProvider,
  init,
} from "@useauthio/xray";

init({
  collectorKey: "xrk_live_replace_with_your_public_key",
  consentProvider: createTCFConsentProvider({
    purposeIds: [1, 10],
    receiptReference: (tcData) => lookupConsentRecord(tcData),
  }),
});

init({
  collectorKey: "xrk_live_replace_with_your_public_key",
  consentProvider: createGPPConsentProvider({
    hasConsent: (event) => controllerPolicyAllowsXRay(event),
    receiptReference: (event) => lookupConsentRecord(event),
  }),
});
```

GPP sections encode jurisdiction-specific notices and opt-outs, so the
controller must supply `hasConsent`; the SDK does not guess legal meaning.
Likewise, the TCF adapter requires explicit purpose grants; `gdprApplies:
false` is not treated as consent and should be handled through the applicable
regional CMP signal.

## Track events

```ts
track({
  type: "page_viewed",
  url: window.location.href,
  referrer: document.referrer,
  campaignToken: "opaque_signed_campaign_token",
});

track({
  type: "email_clicked",
  campaignToken: "opaque_signed_campaign_token",
  destinationUrl: window.location.href,
  scannerSuspected: false,
});
```

Only the OpenAPI allowlist is emitted. Query strings and fragments are removed;
only normalized UTM values and the click-ID **type** are retained. Auth,
callback, magic-link, health, medical, finance, billing, payment, and banking
paths are dropped by default. Add project-specific exclusions with
`excludedPaths`.

## Authenticated session link

The proof must be opaque, expiring, and signed. It must not contain a raw
visitor ID, user ID, project ID, or email.

```ts
await identifyAuthenticatedSession({
  accessToken,
  visitorProof,
});
```

The request body contains only `visitor_proof` and
`consent_receipt_reference`. Authio derives user, project, and organization
context from the verified bearer token.

## Batching and lifecycle delivery

The collector batches up to 20 events, retries transient network/408/425/429/5xx
failures with capped exponential backoff, and uses fetch keepalive during page
lifecycle delivery.

Browsers do not let `sendBeacon` set the OpenAPI-required
`X-Authio-XRay-Key` header. To use native beacon delivery, set `beaconEndpoint`
to a same-origin endpoint that injects the project-bound collector key and
forwards the body unchanged. Without it, lifecycle delivery uses direct
keepalive fetch.

Collection and identify endpoints are restricted to HTTPS Authio hosts.
`beaconEndpoint` is restricted to same-origin HTTPS so it cannot bypass CORS to
disclose queued telemetry.

## Script tag

```html
<script src="https://cdn.jsdelivr.net/npm/@useauthio/xray/dist/xray.global.js"></script>
<script>
  AuthioXRay.init({
    collectorKey: "xrk_live_replace_with_your_public_key",
  });
</script>
```

## OpenAPI mapping

- Each `track` call becomes an `xray.page_viewed.v1` or
  `xray.email_clicked.v1` event.
- Events have random `evt_`, project-scoped `xv_`, and session-scoped `xs_`
  IDs, plus `occurred_at`, `consent`, and a closed allowlisted `payload`.
- Flush sends `{ "events": [...] }` with 1–20 events to `POST /v1/collect`.
- The collector treats only empty `202 Accepted` and `204 No Content` as
  success and never parses an inference response.

## Reset

`reset()` drops queued events and rotates visitor/session IDs while preserving
an active consent grant. Use consent withdrawal when collection must stop.

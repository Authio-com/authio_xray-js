import type {
  ConsentProvider,
  ConsentPurpose,
  ConsentUpdate,
} from "./types";

export interface TCFData {
  eventStatus?: string;
  gdprApplies?: boolean;
  listenerId?: number;
  purpose?: { consents?: Record<string, boolean> };
}

export type TCFApi = (
  command: string,
  version: 2,
  callback: (data: TCFData, success: boolean) => void,
  parameter?: number,
) => void;

export interface GPPEvent {
  eventName?: string;
  listenerId?: number;
  data?: unknown;
  pingData?: unknown;
}

export type GPPApi = (
  command: string,
  callback: (event: GPPEvent, success: boolean) => void,
  parameter?: unknown,
) => void;

export interface TCFConsentProviderOptions {
  api?: TCFApi;
  purposeIds?: number[];
  purposes?: ConsentPurpose[];
  receiptReference: (data: TCFData) => string;
}

export function createTCFConsentProvider(
  options: TCFConsentProviderOptions,
): ConsentProvider {
  return (update) => {
    const api =
      options.api ??
      (globalThis as typeof globalThis & { __tcfapi?: TCFApi }).__tcfapi;
    if (!api) {
      update({ granted: false });
      return;
    }

    let listenerId: number | undefined;
    const purposeIds = options.purposeIds ?? [1, 10];
    const callback = (data: TCFData, success: boolean) => {
      listenerId = data.listenerId ?? listenerId;
      const ready =
        data.eventStatus === "tcloaded" ||
        data.eventStatus === "useractioncomplete";
      if (!success) {
        update({ granted: false });
        return;
      }
      if (!ready) return;

      const granted =
        data.gdprApplies !== false &&
        purposeIds.every((id) => data.purpose?.consents?.[String(id)] === true);
      const consent: ConsentUpdate = granted
        ? {
            granted: true,
            receiptReference: options.receiptReference(data),
            purposes: options.purposes,
            grantedAt: new Date(),
          }
        : { granted: false };
      update(consent);
    };

    api("addEventListener", 2, callback);
    return () => {
      if (listenerId !== undefined) {
        api("removeEventListener", 2, () => undefined, listenerId);
      }
    };
  };
}

export interface GPPConsentProviderOptions {
  api?: GPPApi;
  hasConsent: (event: GPPEvent) => boolean;
  purposes?: ConsentPurpose[];
  receiptReference: (event: GPPEvent) => string;
}

export function createGPPConsentProvider(
  options: GPPConsentProviderOptions,
): ConsentProvider {
  return (update) => {
    const api =
      options.api ??
      (globalThis as typeof globalThis & { __gpp?: GPPApi }).__gpp;
    if (!api) {
      update({ granted: false });
      return;
    }

    let listenerId: number | undefined;
    const callback = (event: GPPEvent, success: boolean) => {
      listenerId = event.listenerId ?? listenerId;
      if (!success) {
        update({ granted: false });
        return;
      }
      let granted = false;
      try {
        granted = options.hasConsent(event);
      } catch {
        update({ granted: false });
        return;
      }
      update(
        granted
          ? {
              granted: true,
              receiptReference: options.receiptReference(event),
              purposes: options.purposes,
              grantedAt: new Date(),
            }
          : { granted: false },
      );
    };

    api("addEventListener", callback);
    return () => {
      if (listenerId !== undefined) {
        api("removeEventListener", () => undefined, listenerId);
      }
    };
  };
}

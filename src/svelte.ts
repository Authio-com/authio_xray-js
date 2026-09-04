import { writable, type Readable } from "svelte/store";
import { XRayCollector } from "./client";
import type {
  ConsentUpdate,
  IdentifyAuthenticatedSessionInput,
  TrackInput,
  XRayClient,
  XRayConfig,
} from "./types";

export interface XRayStore extends Readable<XRayClient> {
  setConsent(consent: ConsentUpdate): void;
  track(event: TrackInput): boolean;
  mintVisitorProof(): Promise<string>;
  identifyAuthenticatedSession(
    input: IdentifyAuthenticatedSessionInput,
  ): Promise<boolean>;
  flush(): Promise<boolean>;
  reset(): void;
  destroy(): void;
}

export function createXRayStore(config: XRayConfig): XRayStore {
  const collector = new XRayCollector(config);
  const { subscribe } = writable<XRayClient>(collector);

  return {
    subscribe,
    setConsent: (consent) => collector.setConsent(consent),
    track: (event) => collector.track(event),
    mintVisitorProof: () => collector.mintVisitorProof(),
    identifyAuthenticatedSession: (input) =>
      collector.identifyAuthenticatedSession(input),
    flush: () => collector.flush(),
    reset: () => collector.reset(),
    destroy: () => collector.destroy(),
  };
}

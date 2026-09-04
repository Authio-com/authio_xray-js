import {
  inject,
  onUnmounted,
  shallowRef,
  type App,
  type InjectionKey,
  type ShallowRef,
} from "vue";
import { XRayCollector } from "./client";
import type {
  ConsentUpdate,
  IdentifyAuthenticatedSessionInput,
  TrackInput,
  XRayClient,
  XRayConfig,
} from "./types";

export const XRayKey: InjectionKey<XRayClient> = Symbol("xray");

export interface UseXRayReturn {
  client: ShallowRef<XRayClient>;
  setConsent(consent: ConsentUpdate): void;
  track(event: TrackInput): boolean;
  mintVisitorProof(): Promise<string>;
  identifyAuthenticatedSession(
    input: IdentifyAuthenticatedSessionInput,
  ): Promise<boolean>;
  flush(): Promise<boolean>;
  reset(): void;
}

export function useXRay(config?: XRayConfig): UseXRayReturn {
  if (config) {
    const collector = new XRayCollector(config);
    const client = shallowRef<XRayClient>(collector);

    onUnmounted(() => {
      collector.destroy();
    });

    return {
      client,
      setConsent: (consent) => client.value.setConsent(consent),
      track: (event) => client.value.track(event),
      mintVisitorProof: () => client.value.mintVisitorProof(),
      identifyAuthenticatedSession: (input) =>
        client.value.identifyAuthenticatedSession(input),
      flush: () => client.value.flush(),
      reset: () => client.value.reset(),
    };
  }

  const injected = inject(XRayKey);
  if (!injected) {
    throw new Error(
      "useXRay() requires either a config argument or createXRayPlugin()",
    );
  }
  const client = shallowRef<XRayClient>(injected);

  return {
    client,
    setConsent: (consent) => client.value.setConsent(consent),
    track: (event) => client.value.track(event),
    mintVisitorProof: () => client.value.mintVisitorProof(),
    identifyAuthenticatedSession: (input) =>
      client.value.identifyAuthenticatedSession(input),
    flush: () => client.value.flush(),
    reset: () => client.value.reset(),
  };
}

export function createXRayPlugin(config: XRayConfig) {
  return {
    install(app: App) {
      const collector = new XRayCollector(config);
      app.provide(XRayKey, collector);
    },
  };
}

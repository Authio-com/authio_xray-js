import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { XRayCollector } from "./client";
import type {
  ConsentUpdate,
  IdentifyAuthenticatedSessionInput,
  TrackInput,
  XRayClient,
  XRayConfig,
} from "./types";

export interface XRayContextValue {
  setConsent(consent: ConsentUpdate): void;
  track(event: TrackInput): boolean;
  mintVisitorProof(): Promise<string>;
  identifyAuthenticatedSession(
    input: IdentifyAuthenticatedSessionInput,
  ): Promise<boolean>;
  flush(): Promise<boolean>;
  reset(): void;
}

const XRayContext = createContext<XRayContextValue | null>(null);

export interface XRayProviderProps {
  config: XRayConfig;
  children: ReactNode;
}

export function XRayProvider({ config, children }: XRayProviderProps) {
  const clientRef = useRef<XRayClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new XRayCollector(config);
  }

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const value: XRayContextValue = {
    setConsent: (consent) => clientRef.current?.setConsent(consent),
    track: (event) => clientRef.current?.track(event) ?? false,
    mintVisitorProof: () =>
      clientRef.current?.mintVisitorProof() ??
      Promise.reject(new Error("XRay not initialized")),
    identifyAuthenticatedSession: (input) =>
      clientRef.current?.identifyAuthenticatedSession(input) ??
      Promise.resolve(false),
    flush: () => clientRef.current?.flush() ?? Promise.resolve(false),
    reset: () => clientRef.current?.reset(),
  };

  return <XRayContext.Provider value={value}>{children}</XRayContext.Provider>;
}

export function useXRay(): XRayContextValue {
  const context = useContext(XRayContext);
  if (!context) {
    throw new Error("useXRay must be used within <XRayProvider>");
  }
  return context;
}

export { XRayContext };

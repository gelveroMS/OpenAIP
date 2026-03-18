"use client";

import Image from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type SmartLoadingTarget = "overlay" | "citizen-main" | "lgu-main" | "admin-main";
export type SmartLoadingRegionId = Exclude<SmartLoadingTarget, "overlay">;

type SmartLoadingRequest = {
  label: string;
  target: SmartLoadingTarget;
};

type SmartLoadingContextValue = {
  beginLoading: (token: symbol, request: SmartLoadingRequest) => void;
  endLoading: (token: symbol) => void;
  registerRegion: (id: SmartLoadingRegionId, node: HTMLDivElement | null) => void;
};

type SmartLoadingProviderProps = {
  children: ReactNode;
};

type VisibleLoaderState = {
  label: string;
  target: SmartLoadingTarget;
} | null;

const SHOW_DELAY_MS = 200;
const MIN_VISIBLE_MS = 400;

const SmartLoadingContext = createContext<SmartLoadingContextValue | null>(null);

function getLatestRequest(requests: Map<symbol, SmartLoadingRequest>): SmartLoadingRequest | null {
  let latestRequest: SmartLoadingRequest | null = null;

  for (const request of requests.values()) {
    latestRequest = request;
  }

  return latestRequest;
}

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center sm:gap-4">
      <div className="relative flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20 lg:h-24 lg:w-24">
        <span
          className="absolute inset-0 rounded-full border-[3px] border-[#144679]/12 border-t-[#144679] animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <Image
          src="/brand/logo3.svg"
          alt="OpenAIP logo"
          width={64}
          height={64}
          className="relative z-10 h-11 w-11 sm:h-14 sm:w-14 lg:h-16 lg:w-16"
        />
      </div>
      <p className="max-w-[18rem] text-sm font-semibold tracking-tight text-[#0B3440] sm:text-base">
        {label}
      </p>
    </div>
  );
}

function OverlayLoader({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-slate-100/88 px-4 backdrop-blur-sm sm:px-6">
      <div role="status" aria-live="polite">
        <LoadingIndicator label={label} />
      </div>
    </div>
  );
}

function RegionLoader({ label }: { label: string }) {
  return (
    <div className="pointer-events-auto flex h-full w-full items-center justify-center overflow-hidden bg-slate-100/78 px-4 py-6 backdrop-blur-sm sm:px-6">
      <div role="status" aria-live="polite">
        <LoadingIndicator label={label} />
      </div>
    </div>
  );
}

export function useSmartLoading() {
  const context = useContext(SmartLoadingContext);

  if (!context) {
    throw new Error("Smart loading components must be used inside SmartLoadingProvider.");
  }

  return context;
}

export default function SmartLoadingProvider({ children }: SmartLoadingProviderProps) {
  const requestsRef = useRef(new Map<symbol, SmartLoadingRequest>());
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleAtRef = useRef<number | null>(null);
  const isVisibleRef = useRef(false);
  const [regionNodes, setRegionNodes] = useState<Partial<Record<SmartLoadingRegionId, HTMLDivElement>>>({});
  const [visibleLoader, setVisibleLoader] = useState<VisibleLoaderState>(null);

  const beginLoading = useCallback((token: symbol, request: SmartLoadingRequest) => {
    requestsRef.current.delete(token);
    requestsRef.current.set(token, request);

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    const latestRequest = getLatestRequest(requestsRef.current);

    if (isVisibleRef.current && latestRequest) {
      setVisibleLoader({
        label: latestRequest.label,
        target: latestRequest.target,
      });
      return;
    }

    if (showTimerRef.current) {
      return;
    }

    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;

      const currentRequest = getLatestRequest(requestsRef.current);
      if (!currentRequest) {
        return;
      }

      visibleAtRef.current = performance.now();
      isVisibleRef.current = true;
      setVisibleLoader({
        label: currentRequest.label,
        target: currentRequest.target,
      });
    }, SHOW_DELAY_MS);
  }, []);

  const endLoading = useCallback((token: symbol) => {
    requestsRef.current.delete(token);

    const latestRequest = getLatestRequest(requestsRef.current);

    if (latestRequest) {
      if (isVisibleRef.current) {
        setVisibleLoader({
          label: latestRequest.label,
          target: latestRequest.target,
        });
        return;
      }

      if (!showTimerRef.current) {
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;

          const currentRequest = getLatestRequest(requestsRef.current);
          if (!currentRequest) {
            return;
          }

          visibleAtRef.current = performance.now();
          isVisibleRef.current = true;
          setVisibleLoader({
            label: currentRequest.label,
            target: currentRequest.target,
          });
        }, SHOW_DELAY_MS);
      }

      return;
    }

    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
      return;
    }

    if (!isVisibleRef.current) {
      return;
    }

    const elapsed = performance.now() - (visibleAtRef.current ?? performance.now());
    const remaining = MIN_VISIBLE_MS - elapsed;

    if (remaining <= 0) {
      isVisibleRef.current = false;
      visibleAtRef.current = null;
      setVisibleLoader(null);
      return;
    }

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }

    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;

      if (requestsRef.current.size > 0) {
        const currentRequest = getLatestRequest(requestsRef.current);
        if (!currentRequest) {
          return;
        }

        visibleAtRef.current = performance.now();
        isVisibleRef.current = true;
        setVisibleLoader({
          label: currentRequest.label,
          target: currentRequest.target,
        });
        return;
      }

      isVisibleRef.current = false;
      visibleAtRef.current = null;
      setVisibleLoader(null);
    }, remaining);
  }, []);

  const registerRegion = useCallback((id: SmartLoadingRegionId, node: HTMLDivElement | null) => {
    setRegionNodes((current) => {
      if (current[id] === node) {
        return current;
      }

      const next = { ...current };

      if (node) {
        next[id] = node;
      } else {
        delete next[id];
      }

      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
      }

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const targetRegion =
    visibleLoader && visibleLoader.target !== "overlay"
      ? regionNodes[visibleLoader.target]
      : null;

  const showOverlay = visibleLoader
    ? visibleLoader.target === "overlay" || !targetRegion
    : false;

  return (
    <SmartLoadingContext.Provider
      value={{
        beginLoading,
        endLoading,
        registerRegion,
      }}
    >
      {children}
      {visibleLoader && showOverlay ? <OverlayLoader label={visibleLoader.label} /> : null}
      {visibleLoader && targetRegion && visibleLoader.target !== "overlay"
        ? createPortal(<RegionLoader label={visibleLoader.label} />, targetRegion)
        : null}
    </SmartLoadingContext.Provider>
  );
}

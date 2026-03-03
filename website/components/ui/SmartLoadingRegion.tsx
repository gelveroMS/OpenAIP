"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  useSmartLoading,
  type SmartLoadingRegionId,
} from "@/components/ui/SmartLoadingProvider";

export type SmartLoadingRegionProps = {
  id: SmartLoadingRegionId;
  children: ReactNode;
};

export default function SmartLoadingRegion({ id, children }: SmartLoadingRegionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const { registerRegion } = useSmartLoading();

  useEffect(() => {
    registerRegion(id, hostRef.current);

    return () => {
      registerRegion(id, null);
    };
  }, [id, registerRegion]);

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {children}
      <div ref={hostRef} className="absolute inset-0 z-[60]" />
    </div>
  );
}

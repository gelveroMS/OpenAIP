"use client";

import { useEffect, useRef } from "react";
import { useSmartLoading, type SmartLoadingTarget } from "@/components/ui/SmartLoadingProvider";

export type SmartFullPageLoaderProps = {
  label?: string;
  target?: SmartLoadingTarget;
};

export default function SmartFullPageLoader({
  label = "Loading OpenAIP",
  target = "overlay",
}: SmartFullPageLoaderProps) {
  const { beginLoading, endLoading } = useSmartLoading();
  const tokenRef = useRef<symbol | null>(null);

  if (!tokenRef.current) {
    tokenRef.current = Symbol("smart-full-page-loader");
  }

  useEffect(() => {
    const token = tokenRef.current;
    if (!token) {
      return;
    }

    beginLoading(token, { label, target });

    return () => {
      endLoading(token);
    };
  }, [beginLoading, endLoading, label, target]);

  return null;
}

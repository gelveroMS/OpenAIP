"use client";

import { useEffect, useState } from "react";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function useFinePointer() {
  const [isFinePointer, setIsFinePointer] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(FINE_POINTER_QUERY);
    const onChange = () => {
      setIsFinePointer(mediaQuery.matches);
    };

    onChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  return isFinePointer;
}

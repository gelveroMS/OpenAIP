"use client";

const SYSTEM_BANNER_EVENT = "openaip:system-banner-changed";
const STORAGE_KEY = "openaip:system-banner-version";
const CHANNEL_NAME = "openaip-system-banner";

type Cleanup = () => void;

function createChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

export function emitSystemBannerChanged() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(SYSTEM_BANNER_EVENT));

  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage write failures.
  }

  const channel = createChannel();
  if (channel) {
    channel.postMessage({ type: SYSTEM_BANNER_EVENT, at: Date.now() });
    channel.close();
  }
}

export function subscribeSystemBannerChanged(onChange: () => void): Cleanup {
  if (typeof window === "undefined") return () => undefined;

  const handleWindowEvent = () => onChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };

  window.addEventListener(SYSTEM_BANNER_EVENT, handleWindowEvent);
  window.addEventListener("storage", handleStorage);

  const channel = createChannel();
  const handleChannelMessage = () => onChange();
  if (channel) {
    channel.addEventListener("message", handleChannelMessage);
  }

  return () => {
    window.removeEventListener(SYSTEM_BANNER_EVENT, handleWindowEvent);
    window.removeEventListener("storage", handleStorage);
    if (channel) {
      channel.removeEventListener("message", handleChannelMessage);
      channel.close();
    }
  };
}


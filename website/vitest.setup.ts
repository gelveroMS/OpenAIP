import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (!process.env.NEXT_PUBLIC_APP_ENV) {
  process.env.NEXT_PUBLIC_APP_ENV = "local";
}

afterEach(() => {
  cleanup();
});

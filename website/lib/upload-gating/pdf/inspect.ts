import { createRequire } from "module";
import { pathToFileURL } from "node:url";

type PdfInspectErrorReason = "encrypted" | "corrupted" | "timeout";
type PdfSourceErrorDiagnostics = {
  sourceName?: string;
  sourceMessage?: string;
};

type PdfLoadingTask = {
  promise: Promise<any>;
  destroy: () => Promise<void> | void;
};

type CanvasPolyfillModule = {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};

type PdfJsModule = {
  getDocument: (input: unknown) => PdfLoadingTask;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
};

export class PdfInspectError extends Error {
  readonly reason: PdfInspectErrorReason;
  readonly sourceName?: string;
  readonly sourceMessage?: string;

  constructor(
    reason: PdfInspectErrorReason,
    message: string,
    diagnostics: PdfSourceErrorDiagnostics = {}
  ) {
    super(message);
    this.reason = reason;
    this.sourceName = diagnostics.sourceName;
    this.sourceMessage = diagnostics.sourceMessage;
  }
}

const nodeRequire = createRequire(import.meta.url);
let workerSrcConfigured = false;
let workerBootstrapPromise: Promise<void> | null = null;
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let canvasPolyfillPromise: Promise<void> | null = null;

const CANVAS_MODULE_ID = ["@napi-rs", "canvas"].join("/");
const PDFJS_MODULE_ID = ["pdfjs-dist", "legacy/build/pdf.mjs"].join("/");
const PDFJS_WORKER_MODULE_ID = ["pdfjs-dist", "build/pdf.worker.mjs"].join("/");

async function ensureCanvasPolyfills(): Promise<void> {
  if (
    typeof globalThis.DOMMatrix !== "undefined" &&
    typeof globalThis.ImageData !== "undefined" &&
    typeof globalThis.Path2D !== "undefined"
  ) {
    return;
  }

  if (!canvasPolyfillPromise) {
    canvasPolyfillPromise = (async () => {
      let canvasModule: CanvasPolyfillModule;
      try {
        canvasModule = (await import(CANVAS_MODULE_ID)) as CanvasPolyfillModule;
      } catch (error) {
        throw new PdfInspectError(
          "corrupted",
          "PDF canvas runtime could not be loaded.",
          getPdfSourceErrorDiagnostics(error)
        );
      }

      const globalWithCanvas = globalThis as Record<string, unknown>;

      if (
        typeof globalWithCanvas.DOMMatrix === "undefined" &&
        typeof canvasModule.DOMMatrix !== "undefined"
      ) {
        globalWithCanvas.DOMMatrix = canvasModule.DOMMatrix;
      }
      if (
        typeof globalWithCanvas.ImageData === "undefined" &&
        typeof canvasModule.ImageData !== "undefined"
      ) {
        globalWithCanvas.ImageData = canvasModule.ImageData;
      }
      if (
        typeof globalWithCanvas.Path2D === "undefined" &&
        typeof canvasModule.Path2D !== "undefined"
      ) {
        globalWithCanvas.Path2D = canvasModule.Path2D;
      }
    })().catch((error) => {
      canvasPolyfillPromise = null;
      throw error;
    });
  }

  await canvasPolyfillPromise;
}

async function ensurePdfWorkerHandler(): Promise<void> {
  const globalWithPdfWorker = globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler?: unknown };
  };

  if (globalWithPdfWorker.pdfjsWorker?.WorkerMessageHandler) {
    return;
  }

  try {
    const workerModule = await import(PDFJS_WORKER_MODULE_ID);
    globalWithPdfWorker.pdfjsWorker = {
      ...(globalWithPdfWorker.pdfjsWorker ?? {}),
      WorkerMessageHandler: workerModule.WorkerMessageHandler,
    };
  } catch {
    // Keep fallback behavior if the worker module cannot be preloaded.
  }
}

function sanitizeSourceValue(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}...`;
}

export function getPdfSourceErrorDiagnostics(
  error: unknown
): PdfSourceErrorDiagnostics {
  if (!error || typeof error !== "object") {
    return {};
  }

  const maybeError = error as { name?: unknown; message?: unknown };
  const sourceName =
    typeof maybeError.name === "string" && maybeError.name.trim().length > 0
      ? sanitizeSourceValue(maybeError.name, 80)
      : undefined;
  const sourceMessage =
    typeof maybeError.message === "string" && maybeError.message.trim().length > 0
      ? sanitizeSourceValue(maybeError.message, 260)
      : undefined;

  return { sourceName, sourceMessage };
}

export async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      await ensureCanvasPolyfills();
      return import(PDFJS_MODULE_ID) as Promise<PdfJsModule>;
    })();
  }

  try {
    return await pdfJsModulePromise;
  } catch (error) {
    // Reset cache so a subsequent attempt can retry after deployment/env changes.
    pdfJsModulePromise = null;
    throw new PdfInspectError(
      "corrupted",
      "PDF parser runtime could not be loaded.",
      getPdfSourceErrorDiagnostics(error)
    );
  }
}

export async function ensurePdfWorkerSrc(): Promise<void> {
  if (!workerBootstrapPromise) {
    workerBootstrapPromise = (async () => {
      const pdfJs = await loadPdfJsModule();
      await ensurePdfWorkerHandler();

      if (workerSrcConfigured) return;
      try {
        const workerPath = nodeRequire.resolve(PDFJS_WORKER_MODULE_ID);
        pdfJs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
        workerSrcConfigured = true;
      } catch {
        // Keep default worker behavior if explicit worker source resolution fails.
      }
    })().catch((error) => {
      workerBootstrapPromise = null;
      throw error;
    });
  }

  await workerBootstrapPromise;
}

function isPasswordProtectedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { name?: unknown; message?: unknown };
  const name = typeof maybeError.name === "string" ? maybeError.name : "";
  const message =
    typeof maybeError.message === "string" ? maybeError.message.toLowerCase() : "";
  return (
    name === "PasswordException" ||
    message.includes("password") ||
    message.includes("encrypted")
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new PdfInspectError("timeout", "PDF parse timeout."));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function inspectPdf(input: {
  fileBuffer: Buffer;
  timeoutMs: number;
}): Promise<{ pageCount: number }> {
  let loadingTask: PdfLoadingTask | null = null;

  try {
    const pdfJs = await loadPdfJsModule();
    await ensurePdfWorkerSrc();

    loadingTask = pdfJs.getDocument({
      data: new Uint8Array(input.fileBuffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    });

    const pdf = await withTimeout(loadingTask.promise, input.timeoutMs);
    const pageCount = Number(pdf.numPages ?? 0);
    try {
      await pdf.cleanup();
      await pdf.destroy();
    } catch {
      // noop
    }
    if (!Number.isFinite(pageCount) || pageCount <= 0) {
      throw new PdfInspectError("corrupted", "PDF has no readable pages.");
    }
    return { pageCount };
  } catch (error) {
    if (error instanceof PdfInspectError) {
      throw error;
    }
    if (isPasswordProtectedError(error)) {
      throw new PdfInspectError(
        "encrypted",
        "Encrypted PDFs are not supported.",
        getPdfSourceErrorDiagnostics(error)
      );
    }
    throw new PdfInspectError(
      "corrupted",
      "PDF cannot be parsed.",
      getPdfSourceErrorDiagnostics(error)
    );
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        // noop
      }
    }
  }
}

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ensurePdfWorkerSrc,
  getPdfSourceErrorDiagnostics,
  PdfInspectError,
} from "./inspect";

export type PdfPageText = {
  pageNumber: number;
  text: string;
  nonWhitespaceChars: number;
};

export type PdfTextPreview = {
  pageCount: number;
  pages: PdfPageText[];
  totalNonWhitespaceChars: number;
  textlessPageCount: number;
};

export type PdfTextContentItem = {
  str?: unknown;
  transform?: unknown;
};

type PositionedTextItem = {
  str: string;
  x: number;
  y: number;
};

type TextLine = {
  y: number;
  tokens: Array<{ x: number; str: string }>;
};

const LINE_Y_TOLERANCE = 2.5;

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
        reject(new PdfInspectError("timeout", "PDF text extraction timeout."));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function countNonWhitespaceChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function toPositionedTextItem(item: PdfTextContentItem): PositionedTextItem | null {
  if (typeof item.str !== "string") return null;
  const str = item.str.trim();
  if (!str) return null;

  const transform = Array.isArray(item.transform) ? item.transform : [];
  const x = typeof transform[4] === "number" ? transform[4] : 0;
  const y = typeof transform[5] === "number" ? transform[5] : 0;
  return { str, x, y };
}

function pickLineForItem(lines: TextLine[], item: PositionedTextItem): TextLine | null {
  let selected: TextLine | null = null;
  let selectedDelta = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const delta = Math.abs(line.y - item.y);
    if (delta <= LINE_Y_TOLERANCE && delta < selectedDelta) {
      selected = line;
      selectedDelta = delta;
    }
  }
  return selected;
}

export function reconstructPdfPageText(items: PdfTextContentItem[]): string {
  const positionedItems = items
    .map(toPositionedTextItem)
    .filter((item): item is PositionedTextItem => item !== null)
    .sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > LINE_Y_TOLERANCE) return yDiff;
      return a.x - b.x;
    });

  const lines: TextLine[] = [];
  for (const item of positionedItems) {
    const existingLine = pickLineForItem(lines, item);
    if (existingLine) {
      existingLine.tokens.push({ x: item.x, str: item.str });
      existingLine.y = (existingLine.y + item.y) / 2;
      continue;
    }
    lines.push({
      y: item.y,
      tokens: [{ x: item.x, str: item.str }],
    });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.tokens
        .sort((a, b) => a.x - b.x)
        .map((token) => token.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

export async function extractPdfTextPreview(input: {
  fileBuffer: Buffer;
  maxPages: number;
  timeoutMs: number;
}): Promise<PdfTextPreview> {
  await ensurePdfWorkerSrc();

  const loadingTask = getDocument({
    data: new Uint8Array(input.fileBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });

  try {
    const pdf = await withTimeout(loadingTask.promise, input.timeoutMs);
    const pageCount = Number(pdf.numPages ?? 0);
    const pagesToRead = Math.max(0, Math.min(pageCount, input.maxPages));
    const pages: PdfPageText[] = [];

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await withTimeout(pdf.getPage(pageNumber), input.timeoutMs);
      const textContent = await withTimeout(page.getTextContent(), input.timeoutMs);
      const text = reconstructPdfPageText(
        textContent.items as PdfTextContentItem[]
      );
      pages.push({
        pageNumber,
        text,
        nonWhitespaceChars: countNonWhitespaceChars(text),
      });
    }

    try {
      await pdf.cleanup();
      await pdf.destroy();
    } catch {
      // noop
    }

    const totalNonWhitespaceChars = pages.reduce(
      (sum, page) => sum + page.nonWhitespaceChars,
      0
    );
    const textlessPageCount = pages.filter(
      (page) => page.nonWhitespaceChars === 0
    ).length;
    return {
      pageCount,
      pages,
      totalNonWhitespaceChars,
      textlessPageCount,
    };
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
      "Failed to extract PDF text.",
      getPdfSourceErrorDiagnostics(error)
    );
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // noop
    }
  }
}

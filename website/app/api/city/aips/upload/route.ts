import { processScopedAipUpload } from "@/lib/upload-gating/server-upload";

export async function POST(request: Request) {
  return processScopedAipUpload(request, { scope: "city" });
}

"use server";

import { isDevAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getLguRepo } from "@/lib/repos/lgu/repo.server";
import type {
  CreateLguInput,
  LguRecord,
  LguStatus,
  UpdateLguInput,
} from "@/lib/repos/lgu/repo";

async function requireAdminOrDev() {
  const actor = await getActorContext();
  if (!actor && isDevAuthBypassEnabled()) return;
  if (!actor || actor.role !== "admin") {
    console.log(actor?.role);
    throw new Error("Unauthorized.");
  }
}

export async function listLgusAction(): Promise<LguRecord[]> {
  await requireAdminOrDev();
  const repo = getLguRepo();
  return repo.list();
}

export async function createLguAction(input: CreateLguInput): Promise<LguRecord> {
  await requireAdminOrDev();
  const repo = getLguRepo();
  return repo.create(input);
}

export async function updateLguAction(
  id: string,
  patch: UpdateLguInput
): Promise<LguRecord> {
  await requireAdminOrDev();
  const repo = getLguRepo();
  return repo.update(id, patch);
}

export async function setLguStatusAction(
  id: string,
  status: LguStatus
): Promise<LguRecord> {
  await requireAdminOrDev();
  const repo = getLguRepo();
  return repo.setStatus(id, status);
}

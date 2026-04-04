"use server";

import { isDevAuthBypassEnabled } from "@/lib/auth/dev-bypass";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getAccountsRepo } from "@/lib/repos/accounts/repo.server";
import type {
  AccountListInput,
  AccountListResult,
  AccountRecord,
  AccountStatus,
  CreateOfficialAccountInput,
  UpdateAccountInput,
} from "@/lib/repos/accounts/repo";

async function requireAdminOrDev() {
  const actor = await getActorContext();
  if (!actor && isDevAuthBypassEnabled()) return;
  if (!actor || actor.role !== "admin") {
    throw new Error("Unauthorized.");
  }
}

export async function listAccountsAction(
  input: AccountListInput
): Promise<AccountListResult> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.list(input);
}

export async function createOfficialAccountAction(
  input: CreateOfficialAccountInput
): Promise<AccountRecord> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.createOfficial(input);
}

export async function updateAccountAction(
  id: string,
  patch: UpdateAccountInput
): Promise<AccountRecord> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.updateAccount(id, patch);
}

export async function setAccountStatusAction(
  id: string,
  status: AccountStatus
): Promise<AccountRecord> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.setStatus(id, status);
}

export async function deleteAccountAction(id: string): Promise<void> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.deleteAccount(id);
}

export async function resetAccountPasswordAction(id: string): Promise<void> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.resetPassword(id);
}

export async function resendInviteAction(id: string): Promise<void> {
  await requireAdminOrDev();
  const repo = getAccountsRepo();
  return repo.resendInvite(id);
}

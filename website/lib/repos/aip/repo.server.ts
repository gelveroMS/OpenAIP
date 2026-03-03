import "server-only";

import { selectRepo } from "@/lib/repos/_shared/selector";
import type { AipProjectRepo, AipRepo, LguScope } from "./repo";
import { createMockAipProjectRepo, createMockAipRepoImpl } from "./repo.mock";
import { createSupabaseAipProjectRepo, createSupabaseAipRepo } from "./repo.supabase";
import type { CreateMockAipRepoOptions } from "./types";

export function getAipRepo(options: CreateMockAipRepoOptions = {}): AipRepo {
  return selectRepo({
    label: "AipRepo",
    mock: () => createMockAipRepoImpl(options),
    supabase: () => createSupabaseAipRepo(),
  });
}

export function getAipProjectRepo(_scope?: LguScope): AipProjectRepo {
  void _scope;
  return selectRepo({
    label: "AipProjectRepo",
    mock: () => createMockAipProjectRepo(),
    supabase: () => createSupabaseAipProjectRepo(),
  });
}


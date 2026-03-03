"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { CommentThreadListCard } from "../components/comment-thread-list-card";
import { FeedbackKpiRow } from "../components/feedback-kpi-row";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommentsView } from "../hooks";
import { CATEGORY_KINDS, formatFeedbackKind } from "@/lib/constants/feedback-kind";

export default function CommentsView({
  scope = "barangay",
  lguId = "lgu_barangay_001",
}: {
  scope?: "city" | "barangay";
  lguId?: string;
} = {}) {
  const {
    loading,
    error,
    threadMap,
    year,
    status,
    kind,
    context,
    query,
    yearOptions,
    contextOptions,
    filteredItems,
    kpiCounts,
    setYear,
    setStatus,
    setKind,
    setContext,
    setQuery,
  } = useCommentsView({ scope, lguId });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Feedback</h1>
        <p className="mt-2 text-sm text-slate-600">
          Review citizen feedback and respond to feedback related to published
          AIPs and projects.
        </p>
      </div>

      {!loading && !error ? <FeedbackKpiRow counts={kpiCounts} /> : null}

      <div className="rounded-2xl p-5">
        <div className="grid grid-cols-1 gap-4 lg:ml-auto lg:w-fit lg:grid-cols-[120px_160px_120px_120px_420px] lg:items-end">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">Year</div>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Years</SelectItem>
                {yearOptions.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500">Project</div>
            <Select value={context} onValueChange={setContext}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {contextOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500">Status</div>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as "all" | "no_response" | "responded")
              }
            >
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="no_response">No response</SelectItem>
                <SelectItem value="responded">Responded</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500">Kind</div>
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger className="h-11 w-full border-slate-200 bg-white">
                <SelectValue placeholder="All Kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                {CATEGORY_KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {formatFeedbackKind(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-2 lg:w-[420px]">
            <div className="text-xs text-slate-500">Search</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by commenter name, comment, or project..."
                className="h-11 w-full border-slate-200 bg-white pl-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {loading ? (
          <div className="text-sm text-slate-500">Loading inbox...</div>
        ) : error ? (
          <div className="text-sm text-rose-600">{error}</div>
        ) : (
          <>
            <div className="text-sm text-slate-500">Showing Feedback</div>

            <div className="space-y-5">
                {filteredItems.map((item) => {
                  const thread = threadMap.get(item.threadId);
                  const authorName = thread?.preview.authorName ?? "Citizen";
                  const authorRoleLabel = thread?.preview.authorRoleLabel ?? null;
                  const authorLguLabel =
                    thread?.preview.authorLguLabel ?? thread?.preview.authorScopeLabel ?? null;

                  return (
                    <Link key={item.threadId} href={item.href} className="block">
                      <CommentThreadListCard
                        authorName={authorName}
                        authorRoleLabel={authorRoleLabel}
                        authorLguLabel={authorLguLabel}
                        updatedAt={item.updatedAt}
                        kind={thread?.preview.kind ?? "question"}
                        contextTitle={item.contextTitle}
                        contextSubtitle={item.contextSubtitle}
                        snippet={item.snippet}
                        status={item.status}
                      />
                    </Link>
                  );
                })}
              </div>
            </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PlatformControlsTabs, {
  PlatformControlsTab,
} from "../components/PlatformControlsTabs";
import CommentRateLimitsCard from "../components/CommentRateLimitsCard";
import FlaggedUsersTable from "../components/FlaggedUsersTable";
import UserAuditHistoryDialog from "../components/UserAuditHistoryDialog";
import BlockUserDialog from "../components/BlockUserDialog";
import UnblockUserDialog from "../components/UnblockUserDialog";
import ChatbotMetricsRow from "../components/ChatbotMetricsRow";
import ChatbotRateLimitsCard from "../components/ChatbotRateLimitsCard";
import { getUsageControlsRepo } from "@/lib/repos/usage-controls/repo";
import type {
  ChatbotMetrics,
  ChatbotRateLimitPolicy,
  FlaggedUserRowVM,
  RateLimitSettingsVM,
  UserAuditHistoryPage,
} from "@/lib/repos/usage-controls/types";

const AUDIT_PAGE_SIZE = 2;

const EMPTY_AUDIT_PAGE: UserAuditHistoryPage = {
  entries: [],
  total: 0,
  offset: 0,
  limit: AUDIT_PAGE_SIZE,
  hasNext: false,
};

export default function PlatformControlsView() {
  const searchParams = useSearchParams();
  const repo = useMemo(() => getUsageControlsRepo(), []);
  const tabParam = searchParams.get("tab");
  const metricsDateFrom = searchParams.get("from");
  const metricsDateTo = searchParams.get("to");
  const initialTab: PlatformControlsTab = tabParam === "chatbot" ? "chatbot" : "feedback";
  const [activeTab, setActiveTab] = useState<PlatformControlsTab>(initialTab);

  const [rateSettings, setRateSettings] = useState<RateLimitSettingsVM | null>(null);
  const [flaggedUsers, setFlaggedUsers] = useState<FlaggedUserRowVM[]>([]);
  const [auditPage, setAuditPage] = useState<UserAuditHistoryPage>(EMPTY_AUDIT_PAGE);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<FlaggedUserRowVM | null>(null);
  const [activeModal, setActiveModal] = useState<"audit" | "block" | "unblock" | null>(null);
  const [chatbotMetrics, setChatbotMetrics] = useState<ChatbotMetrics | null>(null);
  const [chatbotRateLimit, setChatbotRateLimit] = useState<ChatbotRateLimitPolicy | null>(null);

  const [blockReason, setBlockReason] = useState("");
  const [blockDurationValue, setBlockDurationValue] = useState(7);
  const [blockDurationUnit, setBlockDurationUnit] = useState<"days" | "weeks">("days");
  const [unblockReason, setUnblockReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, users, rateLimitPolicy, metrics] = await Promise.all([
        repo.getRateLimitSettings(),
        repo.listFlaggedUsers(),
        repo.getChatbotRateLimitPolicy(),
        repo.getChatbotMetrics({
          dateFrom: metricsDateFrom,
          dateTo: metricsDateTo,
        }),
      ]);
      setRateSettings(settings);
      setFlaggedUsers(users);
      setChatbotMetrics(metrics);
      setChatbotRateLimit(rateLimitPolicy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load platform controls.");
    } finally {
      setLoading(false);
    }
  }, [metricsDateFrom, metricsDateTo, repo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveRateLimits = async (input: {
    maxComments: number;
    timeWindow: "hour" | "day";
  }) => {
    const next = await repo.updateRateLimitSettings(input);
    setRateSettings(next);
  };

  const handleSaveChatbotRateLimits = async (input: {
    maxRequests: number;
    timeWindow: "per_hour" | "per_day";
  }) => {
    const next = await repo.updateChatbotRateLimitPolicy(input);
    setChatbotRateLimit(next);
  };

  const loadAuditPage = useCallback(
    async (row: FlaggedUserRowVM, offset = 0) => {
      setAuditLoading(true);
      setAuditError(null);
      try {
        const page = await repo.getUserAuditHistory({
          userId: row.userId,
          offset,
          limit: AUDIT_PAGE_SIZE,
        });
        setAuditPage(page);
      } catch (err) {
        setAuditError(err instanceof Error ? err.message : "Failed to load audit history.");
      } finally {
        setAuditLoading(false);
      }
    },
    [repo]
  );

  const handleViewAudit = async (row: FlaggedUserRowVM) => {
    setSelectedUser(row);
    setAuditPage(EMPTY_AUDIT_PAGE);
    setAuditError(null);
    setActiveModal("audit");
    await loadAuditPage(row, 0);
  };

  const handleNextAuditPage = async () => {
    if (!selectedUser || auditLoading || !auditPage.hasNext) return;
    await loadAuditPage(selectedUser, auditPage.offset + auditPage.limit);
  };

  const handlePreviousAuditPage = async () => {
    if (!selectedUser || auditLoading || auditPage.offset <= 0) return;
    await loadAuditPage(selectedUser, Math.max(0, auditPage.offset - auditPage.limit));
  };

  const handleBlockUser = (row: FlaggedUserRowVM) => {
    setSelectedUser(row);
    setBlockReason("");
    setBlockDurationValue(7);
    setBlockDurationUnit("days");
    setAuditPage(EMPTY_AUDIT_PAGE);
    setAuditError(null);
    setActiveModal("block");
  };

  const handleUnblockUser = (row: FlaggedUserRowVM) => {
    setSelectedUser(row);
    setUnblockReason("");
    setAuditPage(EMPTY_AUDIT_PAGE);
    setAuditError(null);
    setActiveModal("unblock");
  };

  const confirmBlockUser = async () => {
    if (!selectedUser) return;
    await repo.temporarilyBlockUser({
      userId: selectedUser.userId,
      reason: blockReason,
      durationValue: blockDurationValue,
      durationUnit: blockDurationUnit,
    });
    await refresh();
    setSelectedUser(null);
    setActiveModal(null);
  };

  const confirmUnblockUser = async () => {
    if (!selectedUser) return;
    await repo.unblockUser({ userId: selectedUser.userId, reason: unblockReason });
    await refresh();
    setSelectedUser(null);
    setActiveModal(null);
  };

  const closeAuditDialog = () => {
    setSelectedUser(null);
    setAuditPage(EMPTY_AUDIT_PAGE);
    setAuditError(null);
    setActiveModal(null);
  };

  return (
    <div className="space-y-6 text-[13.5px] text-slate-700">
      <div>
        <h1 className="text-[28px] font-semibold text-slate-900">Platform Controls</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Configure usage protections and manage abusive/flagged users. Govern chatbot availability
          and request limits while viewing chatbot performance metrics
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13.5px] text-blue-900">
        <span className="font-semibold">Admin Role Restrictions:</span> All configuration changes
        and moderation actions are audit-logged with administrator identity and timestamps for
        governance accountability
      </div>

      <PlatformControlsTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "feedback" && (
        <div className="space-y-6">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
              {error}
            </div>
          )}

          <div>
            <div className="text-[15px] font-semibold text-slate-900">Feedback Rate Limits</div>
            <div className="text-[13.5px] text-slate-500">
              Configure feedback submission rate limits to prevent spam and abuse.
            </div>
          </div>

          <CommentRateLimitsCard
            key={rateSettings?.updatedAt ?? "rate-settings"}
            loading={loading || !rateSettings}
            settings={rateSettings}
            onSave={handleSaveRateLimits}
          />

          <div>
            <div className="text-[15px] font-semibold text-slate-900">Flagged Users</div>
            <div className="text-[13.5px] text-slate-500">
              Manage users who have been flagged for policy violations or abusive behavior.
            </div>
          </div>

          <FlaggedUsersTable
            rows={flaggedUsers}
            onViewAudit={handleViewAudit}
            onBlock={handleBlockUser}
            onUnblock={handleUnblockUser}
          />
        </div>
      )}

      {activeTab === "chatbot" && (
        <div className="space-y-6">
          <ChatbotMetricsRow metrics={chatbotMetrics} loading={loading || !chatbotMetrics} />

          <div>
            <div className="text-[15px] font-semibold text-slate-900">Chatbot Rate Limits</div>
            <div className="text-[13.5px] text-slate-500">
              Configure chatbot request rate limits to ensure fair resource allocation and prevent abuse.
            </div>
          </div>

          <ChatbotRateLimitsCard
            key={chatbotRateLimit?.updatedAt ?? "chatbot-rate-limit"}
            policy={chatbotRateLimit}
            loading={loading || !chatbotRateLimit}
            onSave={handleSaveChatbotRateLimits}
          />
        </div>
      )}

      <UserAuditHistoryDialog
        open={activeModal === "audit" && selectedUser !== null}
        onOpenChange={(open) => {
          if (!open) closeAuditDialog();
        }}
        user={selectedUser}
        entries={auditPage.entries}
        total={auditPage.total}
        offset={auditPage.offset}
        hasNext={auditPage.hasNext}
        loading={auditLoading}
        error={auditError}
        onPrevious={handlePreviousAuditPage}
        onNext={handleNextAuditPage}
      />

      <BlockUserDialog
        open={activeModal === "block" && selectedUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUser(null);
            setActiveModal(null);
          }
        }}
        user={selectedUser}
        durationValue={blockDurationValue}
        durationUnit={blockDurationUnit}
        reason={blockReason}
        onDurationValueChange={setBlockDurationValue}
        onDurationUnitChange={setBlockDurationUnit}
        onReasonChange={setBlockReason}
        onConfirm={confirmBlockUser}
      />

      <UnblockUserDialog
        open={activeModal === "unblock" && selectedUser !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUser(null);
            setActiveModal(null);
          }
        }}
        user={selectedUser}
        reason={unblockReason}
        onReasonChange={setUnblockReason}
        onConfirm={confirmUnblockUser}
      />
    </div>
  );
}

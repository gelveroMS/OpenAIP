import { redirect } from "next/navigation";

type PageSearchParams =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

export default async function ChatbotControlsPage({
  searchParams,
}: {
  searchParams?: PageSearchParams;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const params = new URLSearchParams({ tab: "chatbot" });
  const from = resolvedSearchParams.from;
  const to = resolvedSearchParams.to;

  if (typeof from === "string" && from) {
    params.set("from", from);
  }
  if (typeof to === "string" && to) {
    params.set("to", to);
  }

  redirect(`/admin/usage-controls?${params.toString()}`);
}


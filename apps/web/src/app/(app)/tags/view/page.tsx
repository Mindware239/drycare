"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useApi } from "@/lib/api";
import { Alert, PageHeader, Spinner } from "@/components/ui";
import { TagRecord, TagTimeline, type TagTraceData } from "@/components/TagTrace";

function TagView() {
  const code = useSearchParams().get("code") ?? "";
  const { data, error } = useApi<TagTraceData>(code ? `/tags/trace?code=${encodeURIComponent(code)}` : null);
  return (
    <div className="space-y-5">
      <PageHeader title={data ? `Barcode ${data.label.scanCode}` : "Tag record"} subtitle="The customer, order and sale behind this label, and everything that has happened to it." />
      <Link href="/tags" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><ArrowLeft className="h-4 w-4" />All tags</Link>
      {error && <Alert>{error.message}</Alert>}
      {!data && !error ? <Spinner /> : data && (
        <div className="grid items-start gap-5 xl:grid-cols-3 [&>*]:min-w-0">
          <div className="xl:col-span-2"><TagRecord data={data} /></div>
          <TagTimeline data={data} />
        </div>
      )}
    </div>
  );
}

export default function TagViewPage() {
  return <Suspense><TagView /></Suspense>;
}

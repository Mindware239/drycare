"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { MonitorSmartphone } from "lucide-react";
import { useSession } from "@/lib/session";
import { Button, PageHeader } from "@/components/ui";
import { LaundryCheckout } from "@/components/LaundryCheckout";

function NewLaundryOrder() {
  const { branchId, branch } = useSession();
  const machine = useSearchParams().get("machine") ?? undefined;
  return (
    <div className="space-y-5">
      <PageHeader
        title="New self-service order"
        subtitle={`Wash, dry and ironing at ${branch?.name ?? "this store"}. Prices are calculated by the server from your laundry setup.`}
        actions={<a href="/laundry-kiosk" target="_blank" rel="noreferrer"><Button variant="secondary"><MonitorSmartphone className="h-4 w-4" />Open customer screen</Button></a>}
      />
      <LaundryCheckout branchId={branchId} mode="staff" preselectMachine={machine} />
    </div>
  );
}

export default function NewLaundryOrderPage() {
  return <Suspense><NewLaundryOrder /></Suspense>;
}

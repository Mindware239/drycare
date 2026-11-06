"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Batches now open on the Facility transfers page. This keeps older links and bookmarks working. */
function Redirect() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  useEffect(() => { router.replace(id ? `/transfers?batch=${id}` : "/transfers"); }, [id, router]);
  return null;
}

export default function TransferViewPage() {
  return <Suspense><Redirect /></Suspense>;
}

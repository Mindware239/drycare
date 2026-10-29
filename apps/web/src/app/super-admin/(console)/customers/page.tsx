"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ConsoleHeader } from "../admin-ui";
import { CustomerList } from "./CustomerList";

function CustomersInner() {
  const params = useSearchParams();
  return (
    <>
      <ConsoleHeader title="Customers & businesses" description="Every dry-cleaning business registered on DryCare. Open a business to see its owner, branches, usage, subscription, payments and account history." />
      <CustomerList mode="customers" initialSort={params.get("sort") ?? undefined} />
    </>
  );
}

export default function CustomersPage() {
  return <Suspense><CustomersInner /></Suspense>;
}

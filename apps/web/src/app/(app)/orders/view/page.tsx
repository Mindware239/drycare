"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  MapPin,
  PackageCheck,
  Package,
  Percent,
  Printer,
  Receipt,
  TriangleAlert,
  Shirt,
  Tags,
  UserRound,
} from "lucide-react";
import { LOCATION_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, STAGE_LABELS, type GarmentLocation, type GarmentStage } from "@drycare/shared";
import { api, ApiError, newIdempotencyKey, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, isOverdue, money, rupeesToPaise } from "@/lib/format";
import { ScheduleModal } from "@/components/ScheduleModal";
import { Alert, Badge, Button, Card, Field, Input, Modal, OrderStatusBadge, PaymentStatusBadge, Select, Spinner, StageBadge, Table, Td, Textarea, cx } from "@/components/ui";

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m;

function CustomerApprovalActions({ orderId, approval, customerEmail, onUpdated }: {
  orderId: string;
  approval: any;
  customerEmail?: string;
  onUpdated: (order: any) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(action: string, body: Record<string, string>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/orders/${orderId}/approvals/${approval.id}/${action}`, { body });
      if (result.status === "queued") {
        setOtpRequested(true);
        setMessage(`Email OTP delivery queued for ${result.destination}. Confirm the customer received it.`);
      } else {
        onUpdated(result);
        setMessage(success);
      }
    } catch (e) {
      setMessage((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <Field label="Customer name confirming approval">
        <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={120} />
      </Field>
      <Field label="Witness notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Record the customer's decision" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || customerName.trim().length < 2 || notes.trim().length < 3}
          onClick={() => submit("confirm", { method: "verbal", customerName, notes }, "Verbal approval recorded")}
        >
          Record verbal approval
        </Button>
        <Button
          variant="secondary"
          disabled={busy || customerName.trim().length < 2}
          onClick={() => submit("confirm", { method: "signature", customerName, notes }, "In-person sign-off recorded")}
        >
          Record typed-name sign-off
        </Button>
        {customerEmail && !otpRequested && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => submit("request-otp", { channel: "email" }, "")}
          >
            Send email OTP
          </Button>
        )}
      </div>
      {otpRequested && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Customer's 6-digit email code" className="w-52">
            <Input inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
          <Button
            disabled={busy || otp.length !== 6 || customerName.trim().length < 2}
            onClick={() => submit("verify-otp", { otp, customerName }, "Email OTP verified")}
          >
            Verify OTP
          </Button>
        </div>
      )}
      {!customerEmail && <p className="text-xs text-slate-500">Email OTP requires an email address on the customer profile.</p>}
      <p className="text-xs text-slate-500">SMS OTP is unavailable until an SMS provider is configured.</p>
      {message && <p role="status" className="text-xs font-medium text-slate-700">{message}</p>}
    </div>
  );
}

function OrderInner() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { can, branchId, readOnly } = useSession();
  const [scheduling, setScheduling] = useState(false);
  const { data: o, error, loading, setData, reload } = useApi(`/orders/${id}`);
  const [modal, setModal] = useState<null | "pay" | "handover" | "cancel" | "discount" | { refund: any } | { verify: any }>(null);
  const [flash, setFlash] = useState("");
  const justCreated = Boolean(params.get("created"));

  if (loading && !o) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!o) return null;

  const balance = o.invoice?.balance ?? 0;
  const cancelled = o.operationalStatus === "cancelled";
  const readyGarments = o.garments.filter((g: any) => g.currentStatus === "ready");
  const itemById = (iid: string) => o.items.find((i: any) => i.id === iid);
  const overdue = isOverdue(o.promisedAt, o.operationalStatus);
  const pendingGarments = o.garments.filter((g: any) => !["ready", "dispatched", "delivered", "cancelled"].includes(g.currentStatus));
  const completedGarments = o.garments.filter((g: any) => ["dispatched", "delivered"].includes(g.currentStatus));
  const pendingApprovals = (o.approvals ?? []).filter((approval: any) => approval.status === "pending");
  const openExceptions = (o.exceptions ?? []).filter((e: any) => e.status === "open");
  const discountNote = (o.creditNotes ?? []).find((c: any) => c.status === "issued");
  const payable = o.invoice?.payable ?? o.grandTotal;
  const lastPrint = o.printJobs?.[0];

  return (
    <div className="space-y-5 pb-8">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Back to orders
      </Link>
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-800 to-[#167c6c] p-5 text-white shadow-lg shadow-brand-900/10 sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -right-1 -top-12 h-48 w-48 rounded-full border border-white/10" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-100">
                <Receipt className="h-4 w-4" /> Order details
              </p>
              <h1 className="break-all text-2xl font-semibold tracking-tight sm:text-3xl">{o.orderNumber}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={o.operationalStatus} />
                <PaymentStatusBadge total={payable} paid={o.invoice?.paid ?? 0} cancelled={cancelled} />
                {o.express && <Badge color="amber">Express</Badge>}
                {overdue && <Badge color="red">Overdue</Badge>}
                <span className="inline-flex items-center gap-1 text-xs text-brand-100"><MapPin className="h-3.5 w-3.5" />{o.branch?.name}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!readOnly && (
                <a href={`/print/labels?id=${o.id}`} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="!border-white/20 !bg-white/10 !text-white shadow-none hover:!bg-white/20">
                    <Tags className="h-4 w-4" /> Labels
                  </Button>
                </a>
              )}
              <a href={`/print/receipt?id=${o.id}`} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="!border-white/20 !bg-white/10 !text-white shadow-none hover:!bg-white/20">
                  <Printer className="h-4 w-4" /> Receipt
                </Button>
              </a>
              {!cancelled && balance > 0 && !pendingApprovals.length && can("payments.collect") && (
                <Button className="!bg-white !text-brand-900 shadow-sm hover:!bg-brand-50" onClick={() => setModal("pay")}>
                  <CreditCard className="h-4 w-4" /> Collect {money(balance)}
                </Button>
              )}
              {!cancelled && balance > 0 && !discountNote && can("payments.collect") && (
                <Button variant="secondary" className="!border-white/20 !bg-white/10 !text-white shadow-none hover:!bg-white/20" onClick={() => setModal("discount")}>
                  <Percent className="h-4 w-4" /> Discount
                </Button>
              )}
              {readyGarments.length > 0 && can("deliveries.manage") && (
                <Button variant="secondary" className="!border-white/20 !bg-white/10 !text-white shadow-none hover:!bg-white/20" onClick={() => setScheduling(true)}>
                  Schedule delivery
                </Button>
              )}
              {readyGarments.length > 0 && can("garments.process") && (
                <Button className={balance > 0 ? "!border-white/20 !bg-white/10 !text-white shadow-none hover:!bg-white/20" : "!bg-white !text-brand-900 shadow-sm hover:!bg-brand-50"} variant={balance > 0 ? "secondary" : "primary"} onClick={() => setModal("handover")}>
                  <PackageCheck className="h-4 w-4" /> Hand over ({readyGarments.length})
                </Button>
              )}
            </div>
          </div>
          <div className="mt-5 grid gap-2 border-t border-white/15 pt-4 text-sm sm:grid-cols-3">
            <div className="flex items-center gap-2 text-brand-50">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Clock3 className="h-4 w-4" /></span>
              <span><span className="block text-[10px] uppercase tracking-wide text-brand-200">Received</span><span className="font-medium">{dateTime(o.receivedAt)}</span></span>
            </div>
            <div className={cx("flex items-center gap-2", overdue ? "text-red-100" : "text-brand-50")}>
              <span className={cx("flex h-8 w-8 items-center justify-center rounded-lg", overdue ? "bg-red-400/20" : "bg-white/10")}><CalendarClock className="h-4 w-4" /></span>
              <span><span className={cx("block text-[10px] uppercase tracking-wide", overdue ? "text-red-200" : "text-brand-200")}>Promised ready</span><span className="font-medium">{dateTime(o.promisedAt)}</span></span>
            </div>
            <div className="flex items-center gap-2 text-brand-50">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><Shirt className="h-4 w-4" /></span>
              <span><span className="block text-[10px] uppercase tracking-wide text-brand-200">Garment progress</span><span className="font-medium">{completedGarments.length} of {o.garments.length} handed over · {pendingGarments.length} in process</span></span>
            </div>
          </div>
        </div>
      </section>
      {flash && (
        <div>
          <Alert tone="green" onClose={() => setFlash("")}>
            {flash}
          </Alert>
        </div>
      )}
      {justCreated && !cancelled && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5" />Order saved</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <div><dt className="text-xs text-emerald-800/70">Order</dt><dd className="font-mono font-semibold text-emerald-950">{o.orderNumber}</dd></div>
                <div><dt className="text-xs text-emerald-800/70">Customer</dt><dd className="font-semibold text-emerald-950">{o.customer.name}</dd></div>
                <div><dt className="text-xs text-emerald-800/70">Bag</dt><dd className="font-mono font-semibold text-emerald-950">{o.bags?.map((b: any) => b.bagCode).join(", ")}</dd></div>
                <div><dt className="text-xs text-emerald-800/70">Garments</dt><dd className="font-semibold text-emerald-950">{o.garments.length} tagged</dd></div>
                <div><dt className="text-xs text-emerald-800/70">Total · advance</dt><dd className="font-semibold tabular-nums text-emerald-950">{money(payable)} · {money(o.invoice?.paid)}</dd></div>
                <div><dt className="text-xs text-emerald-800/70">Balance</dt><dd className="font-semibold tabular-nums text-emerald-950">{money(balance)}</dd></div>
              </dl>
            </div>
            <div className="flex flex-col items-end gap-2">
              <a href={`/print/labels?id=${o.id}`} target="_blank" rel="noreferrer"><Button><Tags className="h-4 w-4" />Print bag label & {o.garments.length} tags</Button></a>
              <span className="text-xs text-emerald-900">Labels: {lastPrint ? <Badge color={lastPrint.status === "printed" ? "green" : lastPrint.status === "failed" ? "red" : "amber"}>{lastPrint.status}</Badge> : <Badge color="amber">not printed yet</Badge>}</span>
            </div>
          </div>
        </section>
      )}
      {openExceptions.length > 0 && (
        <Alert>
          <span className="inline-flex items-center gap-1.5"><TriangleAlert className="h-4 w-4" />{openExceptions.length} garment exception(s): {openExceptions.map((e: any) => `${e.tagCode} ${e.kind}`).join(", ")}.</span>{" "}
          <Link href="/exceptions" className="font-semibold underline">Review exceptions</Link>
        </Alert>
      )}
      {cancelled && (
        <div>
          <Alert>
            Cancelled: {o.cancelReason}
            {o.invoice?.paid > 0 && <> · {money(o.invoice.paid)} was collected and should be refunded to the customer.</>}
          </Alert>
        </div>
      )}
      {pendingApprovals.length > 0 && (
        <Alert>
          {pendingApprovals.length} customer approval hold(s) must be resolved before production, payment collection, or garment handover.
        </Alert>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Garments on this order</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700"><Shirt className="h-4 w-4" /></span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{o.garments.length}</p>
          <p className="mt-1 text-xs text-slate-500">{readyGarments.length} ready for handover</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Order total</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700"><Receipt className="h-4 w-4" /></span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{money(payable)}</p>
          <p className="mt-1 text-xs text-slate-500">Invoice {o.invoice?.invoiceNumber ?? "not available"}{discountNote ? ` · ${money(discountNote.totalAmount)} discount at collection` : ""}</p>
        </div>
        <div className={cx("rounded-2xl border p-4 shadow-sm", balance > 0 ? "border-amber-200 bg-amber-50/50" : "border-emerald-200 bg-emerald-50/50")}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Balance due</span>
            <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl border", balance > 0 ? "border-amber-200 bg-amber-100 text-amber-800" : "border-emerald-200 bg-emerald-100 text-emerald-800")}>
              {balance > 0 ? <CircleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </span>
          </div>
          <p className={cx("mt-2 text-2xl font-semibold tracking-tight tabular-nums", balance > 0 ? "text-amber-900" : "text-emerald-900")}>{money(balance)}</p>
          <p className="mt-1 text-xs text-slate-500">{balance > 0 ? "Collect before releasing, unless approved on credit" : "This invoice is fully settled"}</p>
        </div>
      </section>

      {(o.approvals ?? []).length > 0 && (
        <Card title="Customer approval holds">
          <div className="space-y-4">
            {o.approvals.map((approval: any) => (
              <section key={approval.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{approval.garmentTypeName} · {approval.serviceName}</p>
                    <p className="mt-1 text-sm text-slate-700">{approval.reason}</p>
                    {approval.trigger === "additional_charge" && (
                      <p className="mt-1 text-xs font-medium text-amber-800">Additional charge awaiting approval: {money(approval.additionalCharge)}</p>
                    )}
                  </div>
                  <Badge color={approval.status === "approved" ? "green" : "amber"}>
                    {approval.status === "approved" ? `Approved · ${methodLabel(approval.method)}` : "Pending approval"}
                  </Badge>
                </div>
                {approval.status === "approved" ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Confirmed by {approval.customerName} · witnessed by {approval.witnessName ?? "staff"} · {dateTime(approval.approvedAt)}
                    {approval.notes ? ` · ${approval.notes}` : ""}
                  </p>
                ) : can("orders.edit") ? (
                  <CustomerApprovalActions
                    orderId={o.id}
                    approval={approval}
                    customerEmail={o.customer.email}
                    onUpdated={setData}
                  />
                ) : (
                  <p className="mt-2 text-xs text-slate-500">A staff member with order-edit permission must record customer approval.</p>
                )}
              </section>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700"><Shirt className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Garments</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">{o.garments.length} tagged item(s) · {readyGarments.length} ready</p>
                </div>
              </div>
            }
            actions={can("garments.process") && <Link href={`/scan?tag=${o.garments[0]?.tagCode ?? ""}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">Scan station <ArrowRight className="h-3.5 w-3.5" /></Link>}
            padded={false}
          >
            <div className="hidden overflow-x-auto md:block">
              <Table head={["Tag", "Garment", "Service", "Stage", "Where", "Rack", ""]}>
                {o.garments.map((g: any) => {
                  const it = itemById(g.orderItemId);
                  return (
                    <tr key={g.id} className="transition hover:bg-slate-50/70">
                      <Td className="font-mono text-xs text-slate-500">{g.tagCode}</Td>
                      <Td>
                        <span className="font-medium text-slate-800">{it?.garmentTypeName}</span>
                        {it?.colour && <span className="text-slate-500"> · {it.colour}</span>}
                        {it?.conditionFlags?.length > 0 && <span className="mt-1 block text-xs text-amber-700">⚠ {it.conditionFlags.join(", ").replace(/_/g, " ")}</span>}
                      </Td>
                      <Td>{it?.serviceName}</Td>
                      <Td><StageBadge stage={g.currentStatus} /></Td>
                      <Td><LocationBadge location={g.location} /></Td>
                      <Td>{g.storageLocation ?? "—"}</Td>
                      <Td>
                        <Link href={`/scan?tag=${g.tagCode}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                          Open <ArrowRight className="h-3 w-3" />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {o.garments.map((g: any) => {
                const it = itemById(g.orderItemId);
                return (
                  <li key={g.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{it?.garmentTypeName}{it?.colour && <span className="font-normal text-slate-500"> · {it.colour}</span>}</p>
                        <p className="mt-1 font-mono text-xs text-slate-500">{g.tagCode}</p>
                        <p className="mt-1 text-xs text-slate-500">{it?.serviceName}{g.storageLocation ? ` · Rack ${g.storageLocation}` : ""}</p>
                        <div className="mt-1"><LocationBadge location={g.location} /></div>
                      </div>
                      <StageBadge stage={g.currentStatus} />
                    </div>
                    {it?.conditionFlags?.length > 0 && <p className="mt-2 text-xs text-amber-700">⚠ {it.conditionFlags.join(", ").replace(/_/g, " ")}</p>}
                    <Link href={`/scan?tag=${g.tagCode}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Open garment <ArrowRight className="h-3 w-3" /></Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-700"><Receipt className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Charges</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">Itemized pricing and tax breakdown</p>
                </div>
              </div>
            }
            padded={false}
          >
            <div className="hidden overflow-x-auto md:block">
              <Table head={["Item", "Qty", "Rate", "Discount", "GST", "Amount"]}>
                {o.items.map((i: any) => (
                  <tr key={i.id} className="transition hover:bg-slate-50/70">
                    <Td>
                      <span className="font-medium text-slate-800">{i.garmentTypeName} — {i.serviceName}</span>
                      {i.overrideReason && <span className="mt-1 block text-xs text-amber-700">Price override: {i.overrideReason} (list {money(i.listUnitPrice)})</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{i.quantity}</Td>
                    <Td className="text-right tabular-nums">{money(i.unitPrice)}</Td>
                    <Td className="text-right tabular-nums">{i.discountAmount ? `− ${money(i.discountAmount)}` : "—"}</Td>
                    <Td className="text-right tabular-nums">{money(i.taxAmount)} <span className="text-xs text-slate-400">({i.taxBps / 100}%)</span></Td>
                    <Td className="text-right font-semibold tabular-nums text-slate-800">{money(i.lineTotal)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {o.items.map((i: any) => (
                <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-800">{i.garmentTypeName}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{i.serviceName} · Qty {i.quantity} × {money(i.unitPrice)}</span>
                    {i.overrideReason && <span className="mt-1 block text-xs text-amber-700">Price override: {i.overrideReason}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums text-slate-800">{money(i.lineTotal)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">GST {money(i.taxAmount)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <dl className="ml-auto w-full max-w-sm space-y-2 border-t border-slate-100 bg-slate-50/50 px-4 py-4 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{money(o.subtotal)}</dd>
              </div>
              {o.surchargeTotal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Express surcharge</dt>
                  <dd className="tabular-nums">{money(o.surchargeTotal)}</dd>
                </div>
              )}
              {o.discountTotal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">− {money(o.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <dt>GST</dt>
                <dd className="tabular-nums">{money(o.taxTotal)}</dd>
              </div>
              <div className={cx("flex justify-between border-t border-slate-200 pt-2", discountNote ? "text-slate-600" : "font-semibold text-slate-900")}>
                <dt>{discountNote ? "Invoice total" : "Total"}</dt>
                <dd className="tabular-nums">{money(o.grandTotal)}</dd>
              </div>
              {discountNote && (
                <>
                  <div className="flex justify-between text-slate-600">
                    <dt>Discount at collection <span className="block text-[11px] text-slate-400">{discountNote.creditNoteNumber} · {discountNote.reason}{discountNote.taxAmount > 0 ? ` · incl. GST ${money(discountNote.taxAmount)}` : ""}</span></dt>
                    <dd className="tabular-nums">− {money(discountNote.totalAmount)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900">
                    <dt>Amount payable</dt>
                    <dd className="tabular-nums">{money(payable)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between text-emerald-700">
                <dt>Paid (advances & payments)</dt>
                <dd className="tabular-nums">{money(o.invoice?.paid)}</dd>
              </div>
              <div className={cx("flex justify-between font-semibold", balance > 0 ? "text-amber-700" : "text-emerald-700")}>
                <dt>Balance due</dt>
                <dd className="tabular-nums">{money(balance)}</dd>
              </div>
            </dl>
          </Card>

          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-700"><Package className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Bags & labels</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">Bag travels with the garments to the facility and back</p>
                </div>
              </div>
            }
            actions={!readOnly && <a href={`/print/labels?id=${o.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">Print / reprint <ArrowRight className="h-3.5 w-3.5" /></a>}
            padded={false}
          >
            <ul className="divide-y divide-slate-100 text-sm">
              {(o.bags ?? []).map((b: any) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Package className="h-4 w-4 text-slate-400" />
                  <span className="font-mono font-semibold text-slate-800">{b.bagCode}</span>
                  <span className="text-slate-500">{b.garmentCount} garment{b.garmentCount === 1 ? "" : "s"}</span>
                  <LocationBadge location={b.location} />
                  <span className="ml-auto text-xs text-slate-500">{b.labelPrintCount > 0 ? `Label printed ${b.labelPrintCount}×` : "Label not printed"}</span>
                </li>
              ))}
            </ul>
            {o.printJobs?.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                Recent prints:
                {o.printJobs.slice(0, 4).map((j: any) => <Badge key={j.id} color={j.status === "printed" ? "green" : j.status === "failed" ? "red" : "amber"}>{j.status} · {j.labelCount} labels · {dateTime(j.createdAt)}</Badge>)}
              </div>
            )}
          </Card>

          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700"><Clock3 className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Order activity</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">{o.history.length} garment status update(s)</p>
                </div>
              </div>
            }
            padded={false}
          >
            {o.history.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">Garment updates will appear here as work progresses.</p>}
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
              {o.history.map((h: any) => (
                <li key={h.id} className="flex flex-wrap items-start gap-2 px-4 py-3 transition hover:bg-slate-50/70">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Clock3 className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-slate-800">
                    {h.transition_kind === "location"
                      ? h.notes
                      : h.new_location && h.previous_status === h.new_status
                        ? `${h.previous_location ? (LOCATION_LABELS[h.previous_location as GarmentLocation] ?? h.previous_location) + " → " : ""}${LOCATION_LABELS[h.new_location as GarmentLocation] ?? h.new_location}`
                        : `${h.previous_status ? STAGE_LABELS[h.previous_status as GarmentStage] + " → " : ""}${STAGE_LABELS[h.new_status as GarmentStage] ?? h.new_status}`}
                      </span>
                      {h.transition_kind === "qc_fail" && <Badge color="red">QC failed</Badge>}
                      {h.transition_kind === "qc_pass" && <Badge color="green">QC passed</Badge>}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">{h.tag_code.split("-").pop()}</span>
                      <span>·</span><span>{dateTime(h.occurred_at)}</span>
                      {h.actor && <><span>·</span><span>{h.actor}</span></>}
                    </span>
                    {h.notes && h.transition_kind !== "location" && !(h.new_location && h.previous_status === h.new_status) && <span className="mt-1 block text-xs text-slate-500">“{h.notes}”</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700"><UserRound className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Customer</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">Order contact details</p>
                </div>
              </div>
            }
          >
            <Link href={`/customers/view?id=${o.customer.id}`} className="group flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-sm font-semibold text-cyan-800 ring-1 ring-cyan-100">{o.customer.name?.slice(0, 1)?.toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-900 group-hover:text-brand-700">{o.customer.name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{o.customer.customerCode}</span>
              </span>
              <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-brand-700" />
            </Link>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-500">Mobile</span><span className="text-right font-medium text-slate-700">{o.customer.phone ?? "Not provided"}</span></div>
              {o.customer.email && <div className="flex justify-between gap-3"><span className="text-slate-500">Email</span><span className="break-all text-right text-slate-700">{o.customer.email}</span></div>}
              <div className="flex justify-between gap-3"><span className="text-slate-500">Collection</span><span className="text-right font-medium text-slate-700">{o.deliveryMethod === "home_delivery" ? "Home delivery" : "Counter collection"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-500">Invoice</span><span className="font-mono text-xs text-slate-700">{o.invoice?.invoiceNumber ?? "—"}</span></div>
            </div>
            {o.notes && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{o.notes}</p></div>}
          </Card>

          <Card
            title={
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700"><CreditCard className="h-[18px] w-[18px]" /></span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Payments</h2>
                  <p className="mt-0.5 text-xs font-normal text-slate-500">{o.payments.length} transaction(s) recorded</p>
                </div>
              </div>
            }
            padded={false}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <span className="text-xs text-slate-500">Amount collected (verified)</span>
              <span className="font-semibold tabular-nums text-emerald-700">{money(o.invoice?.paid ?? 0)}</span>
            </div>
            {o.payments.length === 0 ? (
              <div className="px-4 py-7 text-center">
                <CreditCard className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">No payments recorded</p>
                <p className="mt-1 text-xs text-slate-500">Payments appear here after collection.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {o.payments.map((p: any) => (
                  <li key={p.id} className="px-4 py-3 transition hover:bg-slate-50/70">
                    <div className="flex items-center justify-between">
                      <span className={cx("font-semibold tabular-nums", p.status === "succeeded" ? "text-slate-800" : "text-slate-400 line-through decoration-1", p.status === "pending" && "no-underline")}>{money(p.allocated_amount)}</span>
                      <span className="flex items-center gap-1.5">
                        {p.status !== "succeeded" && <Badge color={p.status === "pending" ? "amber" : "red"}>{p.status === "pending" ? "awaiting bank check" : p.status}</Badge>}
                        <Badge>{methodLabel(p.payment_method)}</Badge>
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {dateTime(p.received_at)} · {p.collected_by}
                      {p.provider_reference && ` · Ref ${p.provider_reference}`}
                    </p>
                    {Number(p.refunded) > 0 && <p className="text-xs text-red-600">Refunded {money(p.refunded)}</p>}
                    {p.status === "pending" && can("payments.collect") && (
                      <button className="mt-1 mr-3 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setModal({ verify: p })}>
                        Verify transfer…
                      </button>
                    )}
                    {p.status === "succeeded" && can("payments.refund") && Number(p.refunded) < Number(p.payment_amount) && (
                      <button className="mt-1 text-xs font-medium text-red-600 hover:underline" onClick={() => setModal({ refund: p })}>
                        Refund…
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {o.refunds.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
                {o.refunds.map((r: any) => (
                  <p key={r.id}>
                    Refund {money(r.amount)} ({methodLabel(r.method)}) — “{r.reason}” · {r.approved_by}
                  </p>
                ))}
              </div>
            )}
          </Card>

          {can("complaints.manage") && (
            <a href={`/claims?orderId=${o.id}`} className="block">
              <Button variant="secondary" className="w-full">Customer complaint / damage claim…</Button>
            </a>
          )}
          {!cancelled && can("orders.cancel") && !o.garments.some((g: any) => ["delivered", "dispatched"].includes(g.currentStatus)) && (
            <Button variant="ghost" className="w-full text-red-600" onClick={() => setModal("cancel")}>
              Cancel order…
            </Button>
          )}
        </div>
      </div>

      {scheduling && (
        <ScheduleModal
          branchId={o.branchId ?? branchId}
          initialKind="delivery"
          customerId={o.customer.id}
          orderId={o.id}
          canCredit={can("orders.release_with_due")}
          onClose={() => setScheduling(false)}
          onDone={() => (setScheduling(false), setFlash("Delivery scheduled. The customer gets the date and a delivery OTP by message."), reload())}
        />
      )}
      {modal === "pay" && <PayModal order={o} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setFlash("Payment recorded."))} />}
      {modal === "handover" && <HandoverModal order={o} ready={readyGarments} itemById={itemById} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setFlash("Handover recorded."))} />}
      {modal === "discount" && <DiscountModal order={o} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setFlash("Discount applied as a credit note."))} />}
      {modal && typeof modal === "object" && "verify" in modal && <VerifyModal payment={modal.verify} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setFlash("Bank transfer updated."))} />}
      {modal === "cancel" && <CancelModal orderId={o.id} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null))} />}
      {modal && typeof modal === "object" && "refund" in modal && (
        <RefundModal payment={modal.refund} onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setFlash("Refund recorded."), reload())} />
      )}
    </div>
  );
}

function PayModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: (d: any) => void }) {
  const balance = order.invoice.balance;
  const [rows, setRows] = useState([{ amount: (balance / 100).toFixed(2), method: "cash", reference: "", pending: false }]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const total = rows.reduce((s, r) => s + (rupeesToPaise(r.amount) || 0), 0);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const d = await api(`/orders/${order.id}/payments`, { body: { payments: rows.map((r) => ({ amount: rupeesToPaise(r.amount), method: r.method, reference: r.reference || undefined, awaitingVerification: r.method === "bank_transfer" && r.pending ? true : undefined })) }, idempotencyKey: key });
      onDone(d);
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={`Collect payment · due ${money(balance)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={total <= 0 || total > balance}>
            Record {money(total)}
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 rounded-lg border border-slate-200 p-2">
          <Field label="Amount (₹)">
            <Input inputMode="decimal" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, "") } : x)))} />
          </Field>
          <Field label="Method">
            <Select value={r.method} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {methodLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          {r.method !== "cash" && (
            <Field label="Transaction reference" className="col-span-2">
              <Input value={r.reference} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
            </Field>
          )}
          {r.method === "bank_transfer" && (
            <label className="col-span-2 flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={r.pending} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pending: e.target.checked } : x)))} />
              Not yet seen in the bank account — record as awaiting verification (it will not count as paid until confirmed)
            </label>
          )}
        </div>
      ))}
      {rows.length < 3 && (
        <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { amount: "", method: "upi", reference: "", pending: false }])}>
          + Split payment
        </Button>
      )}
      {total > balance && <p className="text-sm text-red-600">Total exceeds the balance due.</p>}
    </Modal>
  );
}

function HandoverModal({ order, ready, itemById, onClose, onDone }: { order: any; ready: any[]; itemById: (id: string) => any; onClose: () => void; onDone: (d: any) => void }) {
  const { can } = useSession();
  const [sel, setSel] = useState<string[]>(ready.map((g) => g.id));
  const [method, setMethod] = useState("counter");
  const [notes, setNotes] = useState("");
  const [allow, setAllow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const balance = order.invoice.balance;
  const pending = order.garments.filter((g: any) => !["ready", "dispatched", "delivered", "cancelled"].includes(g.currentStatus)).length;

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      onDone(await api(`/orders/${order.id}/handover`, { body: { garmentIds: sel, method, notes: notes || undefined, allowWithBalance: allow } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Hand over garments"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!sel.length || (balance > 0 && !allow)}>
            Confirm handover of {sel.length}
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      {pending > 0 && <Alert tone="amber">{pending} garment(s) are still in process. This will be a partial delivery.</Alert>}
      <p className="text-sm text-slate-600">Verify each tag against the garment before handing it over.</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {ready.map((g) => (
          <li key={g.id}>
            <label className="flex items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={sel.includes(g.id)} onChange={(e) => setSel(e.target.checked ? [...sel, g.id] : sel.filter((x) => x !== g.id))} />
              <span className="font-mono text-xs">{g.tagCode}</span>
              <span>{itemById(g.orderItemId)?.garmentTypeName}</span>
              <span className="ml-auto text-xs text-slate-500">Rack {g.storageLocation ?? "—"}</span>
            </label>
          </li>
        ))}
      </ul>
      <Field label="Confirmation">
        <Select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="counter">Customer collected at counter</option>
          <option value="otp">Verified by OTP</option>
          <option value="signature">Customer signed receipt</option>
        </Select>
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. collected by spouse" />
      </Field>
      {balance > 0 && (
        <Alert tone="amber">
          Balance of {money(balance)} is still due.
          {can("orders.release_with_due") ? (
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Release on credit (recorded in audit log)
            </label>
          ) : (
            <span className="block">Collect the payment first, or ask a manager to release on credit.</span>
          )}
        </Alert>
      )}
    </Modal>
  );
}

function CancelModal({ orderId, onClose, onDone }: { orderId: string; onClose: () => void; onDone: (d: any) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Cancel order"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep order
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await api(`/orders/${orderId}/cancel`, { body: { reason } }));
              } catch (e) {
                setErr((e as ApiError).message);
                setBusy(false);
              }
            }}
          >
            Cancel order
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">All garments will be marked cancelled and the invoice voided. Any amount already collected must be refunded separately.</p>
      <Field label="Reason" required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function RefundModal({ payment, onClose, onDone }: { payment: any; onClose: () => void; onDone: (d: any) => void }) {
  const max = Number(payment.payment_amount) - Number(payment.refunded);
  const [amount, setAmount] = useState((max / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const paise = rupeesToPaise(amount);
  return (
    <Modal
      open
      title="Issue refund"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!(paise > 0 && paise <= max) || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await api(`/payments/${payment.id}/refunds`, { body: { amount: paise, reason }, idempotencyKey: key }));
              } catch (e) {
                setErr((e as ApiError).message);
                setBusy(false);
              }
            }}
          >
            Refund {paise > 0 ? money(paise) : ""}
          </Button>
        </>
      }
    >
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">
        Original payment: {money(payment.payment_amount)} by {methodLabel(payment.payment_method)}. Refundable: {money(max)}. The refund is paid out by the same method.
      </p>
      <Field label="Amount (₹)">
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      </Field>
      <Field label="Reason" required>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damage compensation, cancelled order" />
      </Field>
    </Modal>
  );
}

function LocationBadge({ location }: { location?: string }) {
  if (!location) return <span className="text-slate-400">—</span>;
  const color = location === "missing" ? "red" : location.startsWith("in_transit") ? "blue" : location === "at_facility" ? "violet" : location === "collected" ? "slate" : "green";
  return <Badge color={color}>{LOCATION_LABELS[location as GarmentLocation] ?? location}</Badge>;
}

/** Final billing discount: previewed on the server (same maths as the invoice), then issued as a credit note. */
function DiscountModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: (d: any) => void }) {
  const [type, setType] = useState<"fixed" | "percent">("fixed");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const encoded = type === "percent" ? Math.round(Number(value) * 100) : rupeesToPaise(value);

  async function run(apply: boolean) {
    setErr("");
    if (!encoded || encoded <= 0) return setPreview(null);
    setBusy(apply);
    try {
      const r = await api<any>(`/orders/${order.id}/collection-discount`, { body: { type, value: encoded, reason: reason.trim() || "Preview", preview: !apply } });
      if (apply) onDone(r.order);
      else setPreview(r);
    } catch (e) {
      setPreview(null);
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Discount at collection" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => run(true)} loading={busy} disabled={!preview || reason.trim().length < 3}>Apply {preview ? money(preview.total) : ""} discount</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => { setType(e.target.value as "fixed" | "percent"); setPreview(null); }}>
            <option value="fixed">Amount (₹)</option>
            <option value="percent">Percent (%)</option>
          </Select>
        </Field>
        <Field label={type === "fixed" ? "Discount (₹, before GST)" : "Discount (%)"}>
          <Input inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} onBlur={() => run(false)} onKeyDown={(e) => { if (e.key === "Enter") run(false); }} placeholder={type === "fixed" ? "e.g. 40" : "e.g. 10"} />
        </Field>
      </div>
      <Field label="Reason" required hint="Recorded with your name in the audit log"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Regular customer, delay compensation" /></Field>
      {preview && (
        <dl className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-slate-600"><dt>Current amount payable</dt><dd className="tabular-nums">{money(order.invoice.payable)}</dd></div>
          <div className="flex justify-between text-slate-600"><dt>Discount{preview.tax > 0 ? ` (incl. ${money(preview.tax)} GST)` : ""}</dt><dd className="tabular-nums">− {money(preview.total)}</dd></div>
          <div className="flex justify-between font-semibold text-slate-900"><dt>New total</dt><dd className="tabular-nums">{money(preview.newGrandTotal)}</dd></div>
          <div className="flex justify-between text-emerald-700"><dt>Advance & payments already received</dt><dd className="tabular-nums">− {money(preview.paid)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-amber-800"><dt>Customer pays now</dt><dd className="tabular-nums">{money(preview.balanceAfter)}</dd></div>
          {preview.needsApproval && <p className="pt-1 text-xs text-amber-700">Above the {preview.limitBps / 100}% counter limit — applied with your manager permission.</p>}
        </dl>
      )}
      <p className="text-xs text-slate-500">Only one collection discount can be given per order. The original invoice is kept; the discount is issued as a credit note.</p>
    </Modal>
  );
}

function VerifyModal({ payment, onClose, onDone }: { payment: any; onClose: () => void; onDone: (d: any) => void }) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "confirmed" | "rejected">("");
  async function submit(outcome: "confirmed" | "rejected") {
    setErr("");
    setBusy(outcome);
    try {
      onDone(await api(`/payments/${payment.id}/verify`, { body: { outcome, note } }));
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy("");
    }
  }
  return (
    <Modal open title={`Verify bank transfer · ${money(payment.allocated_amount)}`} onClose={onClose}
      footer={<><Button variant="danger" onClick={() => submit("rejected")} loading={busy === "rejected"} disabled={note.trim().length < 3 || Boolean(busy)}>Not received</Button><Button onClick={() => submit("confirmed")} loading={busy === "confirmed"} disabled={note.trim().length < 3 || Boolean(busy)}>Received in bank</Button></>}>
      {err && <Alert>{err}</Alert>}
      <p className="text-sm text-slate-600">Reference <span className="font-mono">{payment.provider_reference}</span>. Check your bank statement before confirming — a customer screenshot is not proof of payment.</p>
      <Field label="Verification note" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Seen in HDFC statement 28 Oct" /></Field>
    </Modal>
  );
}

export default function OrderPage() {
  return (
    <Suspense>
      <OrderInner />
    </Suspense>
  );
}

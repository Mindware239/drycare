"use client";
import { useEffect, useState } from "react";
import { dateTime } from "@/lib/format";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Spinner, Table, Td } from "@/components/ui";
import { BillingSettings } from "@/components/BillingSettings";

export default function SettingsPage() {
  const { can, branchId } = useSession();
  const org = useApi("/organizations/current");
  const branches = useApi<any[]>("/branches");
  const [locBranch, setLocBranch] = useState(branchId);
  const locations = useApi<any[]>(`/storage-locations?branchId=${locBranch}`);
  const [f, setF] = useState<any>(null);
  const [msg, setMsg] = useState<{ t: "green" | "red"; m: string } | null>(null);
  const [nb, setNb] = useState({ name: "", branchCode: "", phone: "", city: "" });
  const [loc, setLoc] = useState({ code: "", description: "" });

  useEffect(() => {
    if (org.data && !f)
      setF({
        name: org.data.name,
        legalName: org.data.legalName ?? "",
        gstin: org.data.gstin ?? "",
        maxDiscount: String((org.data.settings.maxDiscountBpsWithoutApproval ?? 1000) / 100),
        express: String((org.data.settings.expressSurchargeBps ?? 5000) / 100),
        turnaround: String(org.data.settings.defaultTurnaroundHours ?? 48),
        duplicateMatch: org.data.settings.customerDuplicateMatch ?? ["phone"],
      });
  }, [org.data, f]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ t: "green", m: ok });
    } catch (e) {
      setMsg({ t: "red", m: (e as ApiError).message });
    }
  };

  if (!f || !branches.data) return <Spinner />;
  return (
    <div className="space-y-5">
      <PageHeader title="Business settings" subtitle="Business details, invoice & payment details, branches, racks and backups." />
      {msg && <Alert tone={msg.t} onClose={() => setMsg(null)}>{msg.m}</Alert>}
      {can("org.manage") && <DesktopCards />}
      {can("org.manage") && (
        <Card title="Business details & rules">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Business name">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Legal name">
              <Input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} />
            </Field>
            <Field label="GSTIN" hint="15 characters, e.g. 07ABCDE1234F1Z5">
              <Input value={f.gstin} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().replace(/\s/g, "") })} className="font-mono" />
            </Field>
            <Field label="Max counter discount %" hint="Above this needs manager approval">
              <Input value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
            </Field>
            <Field label="Express surcharge %">
              <Input value={f.express} onChange={(e) => setF({ ...f, express: e.target.value })} />
            </Field>
            <Field label="Default turnaround (hours)">
              <Input value={f.turnaround} onChange={(e) => setF({ ...f, turnaround: e.target.value })} />
            </Field>
            <fieldset className="space-y-2 sm:col-span-3">
              <legend className="text-xs font-medium text-slate-700">Potential duplicate customer checks</legend>
              <p className="text-xs text-slate-500">Warn when a new profile matches a selected field. Staff can choose to proceed after reviewing the match.</p>
              <div className="flex flex-wrap gap-4">
                {(["phone", "email"] as const).map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={f.duplicateMatch.includes(field)}
                      onChange={(e) => setF({
                        ...f,
                        duplicateMatch: e.target.checked
                          ? [...f.duplicateMatch, field]
                          : f.duplicateMatch.filter((match: string) => match !== field),
                      })}
                    />
                    {field === "phone" ? "Mobile number" : "Email address"}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <Button
            className="mt-3"
            onClick={() =>
              run(
                () =>
                  api("/organizations/current", {
                    method: "PATCH",
                    body: {
                      name: f.name,
                      legalName: f.legalName || undefined,
                      gstin: f.gstin || undefined,
                      settings: {
                        maxDiscountBpsWithoutApproval: Math.round(Number(f.maxDiscount) * 100),
                        expressSurchargeBps: Math.round(Number(f.express) * 100),
                        defaultTurnaroundHours: Number(f.turnaround),
                        customerDuplicateMatch: f.duplicateMatch,
                      },
                    },
                  }),
                "Settings saved.",
              )
            }
          >
            Save settings
          </Button>
        </Card>
      )}

      {can("org.manage") && org.data && <BillingSettings org={org.data} onSaved={org.reload} />}

      <Card title="Branches" padded={false}>
        <Table head={["Code", "Name", "Phone", "City", "Status", ""]}>
          {branches.data.map((b) => (
            <tr key={b.id}>
              <Td className="font-mono">{b.branchCode}</Td>
              <Td className="font-medium">{b.name}</Td>
              <Td>{b.phone ?? "—"}</Td>
              <Td>{b.address?.city ?? "—"}</Td>
              <Td>{b.status === "active" ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => run(() => api(`/branches/${b.id}`, { method: "PATCH", body: { status: b.status === "active" ? "inactive" : "active" } }).then(branches.reload), "Branch updated.")}>
                  {b.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-2 border-t border-slate-100 p-4 sm:grid-cols-5">
          <Input placeholder="Branch name" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
          <Input placeholder="Code (e.g. BKC)" value={nb.branchCode} onChange={(e) => setNb({ ...nb, branchCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) })} />
          <Input placeholder="Phone" value={nb.phone} onChange={(e) => setNb({ ...nb, phone: e.target.value })} />
          <Input placeholder="City" value={nb.city} onChange={(e) => setNb({ ...nb, city: e.target.value })} />
          <Button
            disabled={!nb.name || nb.branchCode.length < 2}
            onClick={() =>
              run(
                () => api("/branches", { body: { name: nb.name, branchCode: nb.branchCode, phone: nb.phone || undefined, address: nb.city ? { city: nb.city } : undefined } }).then(() => (branches.reload(), setNb({ name: "", branchCode: "", phone: "", city: "" }))),
                "Branch created. Sign out and in again to see it in the branch selector.",
              )
            }
          >
            Add branch
          </Button>
        </div>
      </Card>

      <Card
        title="Racks & storage locations"
        actions={
          <Select value={locBranch} onChange={(e) => setLocBranch(e.target.value)} className="w-auto py-1">
            {branches.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {locations.data?.map((l) => (
            <Badge key={l.id} color="slate">
              {l.code}
              {l.description && ` · ${l.description}`}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Code (e.g. C4)" value={loc.code} onChange={(e) => setLoc({ ...loc, code: e.target.value.toUpperCase() })} className="w-36" />
          <Input placeholder="Description" value={loc.description} onChange={(e) => setLoc({ ...loc, description: e.target.value })} className="w-64" />
          <Button variant="secondary" disabled={!loc.code} onClick={() => run(() => api("/storage-locations", { body: { branchId: locBranch, ...loc, description: loc.description || undefined } }).then(() => (locations.reload(), setLoc({ code: "", description: "" }))), "Location added.")}>
            Add location
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Standalone PC edition only: local backups and shop-network access. */
function DesktopCards() {
  const info = useApi("/system/info");
  const backups = useApi(info.data?.edition === "desktop" ? "/system/backups" : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (info.data?.edition !== "desktop") return null;
  const kb = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  return (
    <>
      <Card
        title="Backups"
        actions={
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await api("/system/backups", { body: {} });
                backups.reload();
              } catch (e) {
                setErr((e as ApiError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Back up now
          </Button>
        }
      >
        {err && <Alert>{err}</Alert>}
        <p className="text-sm text-slate-600">
          DryCare backs up automatically every day when it starts and when it closes. Backups are saved in <code className="rounded bg-slate-100 px-1">{backups.data?.folder}</code>. Copy this
          folder to a pen drive or Google Drive regularly — a backup on the same PC does not protect against disk failure or theft. To restore, use the <strong>DryCare → Restore backup…</strong> menu.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {backups.data?.items.slice(0, 8).map((b: any) => (
            <li key={b.name} className="flex justify-between py-1.5">
              <span>
                {dateTime(b.createdAt)} <Badge>{b.kind}</Badge>
              </span>
              <span className="text-slate-500">{kb(b.sizeBytes)}</span>
            </li>
          ))}
          {backups.data?.items.length === 0 && <li className="py-2 text-slate-500">No backups yet.</li>}
        </ul>
      </Card>
      <Card title="Other computers in the shop">
        {info.data.lanAccess ? (
          <p className="text-sm text-slate-600">
            Other PCs, tablets and phones on the same Wi-Fi can open DryCare in a browser at{" "}
            {info.data.lanUrls.map((u: string) => (
              <code key={u} className="mr-2 rounded bg-slate-100 px-1">
                {u}
              </code>
            ))}
            . Each person signs in with their own staff account.
          </p>
        ) : (
          <p className="text-sm text-slate-600">Only this PC can use DryCare. To let a second counter PC or a tablet connect over the shop Wi-Fi, turn on <strong>DryCare → Allow other computers in this shop</strong> in the menu.</p>
        )}
      </Card>
    </>
  );
}

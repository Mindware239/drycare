"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImageIcon, Package, Plus, Trash2, UploadCloud } from "lucide-react";
import { DEFAULT_HARDWARE_STORE, STORE_CATEGORIES, packagePrice, type HardwareStore, type StoreCategory, type StoreKind, type StoreProduct } from "@drycare/shared";
import { api } from "@/lib/api";
import { Alert, Badge, Button, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { ConsoleHeader, DataTable, EmptyState, LoadingRows, Panel, useAdminData } from "../admin-ui";

const inr = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
const rupees = (paise: number | null) => (paise === null ? "" : String(paise / 100));
const toPaise = (text: string) => (text.trim() === "" ? null : Math.round(Number(text) * 100));
const validPrice = (text: string) => text.trim() === "" || /^\d+(\.\d{1,2})?$/.test(text.trim());
const blank = (): StoreProduct => ({ key: `item-${Date.now().toString(36)}`, name: "", category: "scanning", kind: "equipment", unit: "piece", description: "", specs: [], compatibility: "", pricePaise: null, imageUrl: null, published: true });

export default function HardwareStorePage() {
  const { data, error } = useAdminData<HardwareStore>("/platform-admin/hardware-store");
  const [store, setStore] = useState<HardwareStore | null>(null);
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [charge, setCharge] = useState("");
  useEffect(() => { if (data) { setStore(data); setSaved(JSON.stringify(data)); setCharge(rupees(data.deliveryChargePaise)); } }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!store) return <Panel><LoadingRows /></Panel>;
  const dirty = JSON.stringify(store) !== saved;
  const unpriced = store.products.filter((p) => p.pricePaise === null).length;

  async function save() {
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const after = await api<HardwareStore>("/platform-admin/hardware-store", { method: "PUT", body: store });
      setSaved(JSON.stringify(after));
      setStore(after);
      setNotice("Saved. The website shows this now.");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
    }
    setBusy(false);
  }
  const setQty = (pkg: string, product: string, qty: number) => setStore({ ...store!, packages: store!.packages.map((p) => (p.key !== pkg ? p : { ...p, items: qty > 0 ? (p.items.some((l) => l.product === product) ? p.items.map((l) => (l.product === product ? { ...l, qty } : l)) : [...p.items, { product, qty }]) : p.items.filter((l) => l.product !== product) })) });
  const putProduct = (next: StoreProduct) => setStore({ ...store!, products: isNew ? [...store!.products, next] : store!.products.map((p) => (p.key === next.key ? next : p)) });
  const removeProduct = (key: string) => setStore({ ...store!, products: store!.products.filter((p) => p.key !== key), packages: store!.packages.map((p) => ({ ...p, items: p.items.filter((l) => l.product !== key) })) });

  return (
    <>
      <ConsoleHeader title="Hardware store" description="Products, prices, pictures and packages shown on the website's Hardware & Accessories page. Nothing changes until you save." actions={<>
        <Link href="/hardware" target="_blank" className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">View on website</Link>
        <Link href="/super-admin/leads" className="inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Hardware enquiries</Link>
        <Button disabled={!dirty} loading={busy} onClick={() => void save()}>Save changes</Button>
      </>} />
      <div className="mb-5 space-y-3">
        {failure && <Alert>{failure}</Alert>}
        {notice && !dirty && <Alert tone="green" onClose={() => setNotice("")}>{notice}</Alert>}
        {unpriced > 0 && <Alert tone="amber">{unpriced === 1 ? "1 product has no price yet. It shows Get a quote, and any package containing it shows Price on quotation." : `${unpriced} products have no price yet. They show Get a quote, and any package containing them shows Price on quotation.`}</Alert>}
      </div>
      <div className="space-y-6">
        <Panel title="Packages" description="Set how many of each product comes in each package. Use 0 to leave it out. Totals appear once every item in a package has a price." padded={false}>
          <DataTable minWidth={760} head={["Product", ...store.packages.map((p) => p.name)]}>
            {store.products.map((p) => (
              <tr key={p.key}>
                <td className="px-5 py-2.5 font-medium text-slate-900">{p.name}<span className="block text-xs font-normal text-slate-500">{p.pricePaise === null ? `No price yet · sold by the ${p.unit}` : `${inr(p.pricePaise)} per ${p.unit}`}</span></td>
                {store.packages.map((k) => (
                  <td key={k.key} className="px-5 py-2.5"><Input aria-label={`${p.name} in ${k.name}`} type="number" min={0} max={1000} className="w-20" value={k.items.find((l) => l.product === p.key)?.qty ?? 0} onChange={(e) => setQty(k.key, p.key, Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></td>
                ))}
              </tr>
            ))}
            <tr className="bg-slate-50/60">
              <td className="px-5 py-3 font-semibold text-slate-900">Hardware total</td>
              {store.packages.map((k) => { const t = packagePrice(k, store.products); return <td key={k.key} className="px-5 py-3 font-semibold tabular-nums">{t === null ? <span className="text-xs font-normal text-slate-500">Prices needed</span> : inr(t)}</td>; })}
            </tr>
            <tr className="bg-slate-50/60">
              <td className="px-5 py-3 font-semibold text-slate-900">Total with freight, delivery and installation</td>
              {store.packages.map((k) => { const t = packagePrice(k, store.products); return <td key={k.key} className="px-5 py-3 font-semibold tabular-nums">{t === null ? "—" : inr(t + store.deliveryChargePaise)}</td>; })}
            </tr>
          </DataTable>
        </Panel>

        <Panel title="Freight, delivery and installation" description="Added once to each package, in India only. Other countries see that it is quoted.">
          <Field label="Charge in India (₹)" hint="Prices on the website are shown as excluding GST."><Input aria-label="Charge in India" className="max-w-xs" inputMode="decimal" value={charge} onChange={(e) => { setCharge(e.target.value); if (/^\d+(\.\d{1,2})?$/.test(e.target.value.trim())) setStore({ ...store, deliveryChargePaise: toPaise(e.target.value)! }); }} /></Field>
        </Panel>

        <Panel title="Products" padded={false} actions={<Button variant="secondary" onClick={() => { setIsNew(true); setEditing(blank()); }}><Plus className="h-4 w-4" />Add product</Button>}>
          {!store.products.length ? <div className="p-6"><EmptyState icon={Package} title="No products">Add the first product.</EmptyState></div> : (
            <DataTable minWidth={820} head={["", "Product", "Category", "Type", "Price", "On website", ""]}>
              {store.products.map((p) => (
                <tr key={p.key}>
                  <td className="px-5 py-2.5">{p.imageUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.imageUrl} alt="" className="h-10 w-10 rounded-lg border border-slate-200 object-contain" />
                    : <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-400" title="No picture"><ImageIcon className="h-4 w-4" /></span>}</td>
                  <td className="px-5 py-2.5 font-medium text-slate-900">{p.name}</td>
                  <td className="px-5 py-2.5 text-xs text-slate-600">{STORE_CATEGORIES.find((c) => c.key === p.category)?.name}</td>
                  <td className="px-5 py-2.5"><Badge color={p.kind === "consumable" ? "blue" : "slate"}>{p.kind === "consumable" ? "Consumable" : "Equipment"}</Badge></td>
                  <td className="px-5 py-2.5 tabular-nums">{p.pricePaise === null ? <span className="text-xs text-slate-500">Get a quote</span> : inr(p.pricePaise)}</td>
                  <td className="px-5 py-2.5"><Badge color={p.published ? "green" : "slate"}>{p.published ? "Shown" : "Hidden"}</Badge></td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-end"><Button size="sm" variant="ghost" onClick={() => { setIsNew(false); setEditing(p); }}>Edit</Button><button type="button" aria-label={`Remove ${p.name}`} className="dc-press ms-1 inline-grid h-8 w-8 cursor-pointer place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => removeProduct(p.key)}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <p className="text-xs text-slate-500">{`Starting list: ${DEFAULT_HARDWARE_STORE.products.length} products and ${DEFAULT_HARDWARE_STORE.packages.length} packages. Quantities are suggestions for you to change.`}</p>
      </div>
      {editing && <ProductEditor product={editing} isNew={isNew} onClose={() => setEditing(null)} onSave={(p) => { putProduct(p); setEditing(null); }} />}
    </>
  );
}

function ProductEditor({ product, isNew, onClose, onSave }: { product: StoreProduct; isNew: boolean; onClose: () => void; onSave: (p: StoreProduct) => void }) {
  const [p, setP] = useState(product);
  const [price, setPrice] = useState(rupees(product.pricePaise));
  const [specs, setSpecs] = useState(product.specs.join("\n"));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const ok = p.name.trim().length >= 2 && p.unit.trim() && validPrice(price);
  async function upload(chosen: File) {
    setUploading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/platform-admin/hardware-store/images", { method: "POST", headers: { "content-type": "application/octet-stream", "x-drycare-csrf": "1" }, body: chosen });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "The picture could not be uploaded.");
      setP((x) => ({ ...x, imageUrl: body.url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The picture could not be uploaded.");
    }
    setUploading(false);
  }
  return (
    <Modal open wide title={isNew ? "Add product" : `Edit ${product.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!ok || uploading} onClick={() => onSave({ ...p, name: p.name.trim(), pricePaise: toPaise(price), specs: specs.split("\n").map((s) => s.trim()).filter(Boolean) })}>Done</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <div className="flex items-center gap-3 sm:col-span-2">
          <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-slate-400">{p.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.imageUrl} alt="" className="h-full w-full object-contain" />
            : <ImageIcon className="h-6 w-6" />}</span>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Product picture" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <div className="flex flex-col items-start gap-1">
            <Button size="sm" variant="secondary" loading={uploading} onClick={() => file.current?.click()}><UploadCloud className="h-3.5 w-3.5" />{p.imageUrl ? "Change picture" : "Upload picture"}</Button>
            <span className="text-xs text-slate-500">PNG, JPG or WebP, up to 3 MB. Use your own photos.</span>
            {p.imageUrl && <button type="button" className="cursor-pointer text-xs font-medium text-red-700 underline" onClick={() => setP({ ...p, imageUrl: null })}>Remove picture</button>}
          </div>
        </div>
        <Field label="Name" required><Input value={p.name} maxLength={80} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Price (₹)" hint={validPrice(price) ? "Leave empty to show Get a quote. Excluding GST." : "Enter a number, with up to 2 decimals."}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Category"><Select value={p.category} onChange={(e) => setP({ ...p, category: e.target.value as StoreCategory })}>{STORE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</Select></Field>
        <Field label="Type"><Select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as StoreKind })}><option value="equipment">Equipment: one-time purchase</option><option value="consumable">Consumable: reordered</option></Select></Field>
        <Field label="Sold by the" hint="For example piece or roll."><Input value={p.unit} maxLength={20} onChange={(e) => setP({ ...p, unit: e.target.value })} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={p.published} onChange={(e) => setP({ ...p, published: e.target.checked })} />Show on the website</label>
        <Field label="Short description" className="sm:col-span-2"><Textarea rows={2} maxLength={300} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <Field label="Specifications" hint="One per line." className="sm:col-span-2"><Textarea rows={3} value={specs} onChange={(e) => setSpecs(e.target.value)} /></Field>
        <Field label="Works with Drycare" className="sm:col-span-2"><Textarea rows={2} maxLength={300} value={p.compatibility} onChange={(e) => setP({ ...p, compatibility: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

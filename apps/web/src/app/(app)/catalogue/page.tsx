"use client";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, History, Layers3, Pencil, Plus, Search, Shirt, Sparkles, Tag, X } from "lucide-react";
import { PROCESS_STAGES, STAGE_LABELS, type GarmentStage } from "@drycare/shared";
import { api, ApiError, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { dateTime, money, rupeesToPaise } from "@/lib/format";
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { GARMENT_ART_OPTIONS, GarmentThumb, garmentArtPng, garmentArtUrl, matchGarmentArt } from "@/components/GarmentArt";

export default function CataloguePage() {
  const { session, can } = useSession();
  const gts = useApi<any[]>("/garment-types");
  const svcs = useApi<any[]>("/services");
  const lists = useApi<any[]>("/price-lists");
  const [listId, setListId] = useState("");
  const prices = useApi<any[]>(listId ? `/price-lists/${listId}/prices` : null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [modal, setModal] = useState<null | "garment" | "service" | "list" | { editService: any } | { editGarment: any } | { history: { garmentTypeId: string; serviceId: string } }>(null);
  const [search, setSearch] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [garmentCategory, setGarmentCategory] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const canManage = can("catalogue.manage");

  useEffect(() => {
    if (lists.data?.length && !listId) setListId(lists.data[0].id);
  }, [lists.data, listId]);

  if (gts.error || svcs.error || lists.error) return <Alert>{gts.error?.message ?? svcs.error?.message ?? lists.error?.message}</Alert>;
  if (!gts.data || !svcs.data || !lists.data) return <Spinner />;
  const activeSvcs = svcs.data.filter((s) =>
    `${s.name} ${s.serviceCode}`.toLocaleLowerCase().includes(serviceSearch.trim().toLocaleLowerCase()) &&
    (!serviceCategory || s.category === serviceCategory),
  );
  const visibleGarments = gts.data.filter((g) =>
    `${g.name} ${g.category}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (!garmentCategory || g.category === garmentCategory),
  );
  const garmentCategories = [...new Set(gts.data.map((g) => g.category))].sort();
  const serviceCategories = [...new Set(svcs.data.map((s) => s.category))].sort();
  const configuredPrices = prices.data?.filter((p) => p.unitPrice != null).length ?? 0;
  const totalPrices = gts.data.length * svcs.data.length;
  const priceFor = (g: string, s: string) => prices.data?.find((p) => p.garmentTypeId === g && p.serviceId === s);

  async function setPrice(g: any, s: any, value: string, taxBps: number, effectiveFrom?: string) {
    setErr("");
    setOk("");
    const paise = rupeesToPaise(value);
    if (isNaN(paise) || paise < 1 || !Number.isInteger(taxBps) || taxBps < 0 || taxBps > 5000) return setErr("Enter a positive price and a valid GST rate (0–50%).");
    try {
      await api(`/price-lists/${listId}/prices`, { body: { garmentTypeId: g.id, serviceId: s.id, unitPrice: paise, taxBps, effectiveFrom } });
      setOk(`${g.name} · ${s.name} set to ${money(paise)}${effectiveFrom ? ` from ${dateTime(effectiveFrom)}` : ""}. Existing orders keep their original price.`);
      prices.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  async function toggleGarment(g: any) {
    setErr("");
    setOk("");
    try {
      await api(`/garment-types/${g.id}`, { method: "PATCH", body: { active: !g.active } });
      await gts.reload();
      setOk(`${g.name} ${g.active ? "disabled" : "enabled"}.`);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Services & prices"
        subtitle="Manage your garment menu and branch pricing. Updates apply to new orders; existing invoices stay unchanged."
        actions={
          <>
            {canManage && <Button variant="secondary" onClick={() => setModal("garment")}><Plus className="h-4 w-4" />
              Add garment
            </Button>}
            {canManage && <Button onClick={() => setModal("service")}><Plus className="h-4 w-4" />
              Add service
            </Button>}
          </>
        }
      />
      {canManage && <StandardCatalogueBanner onInstalled={(msg) => { gts.reload(); prices.reload(); setOk(msg); }} />}
      <section aria-label="Catalogue overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Garment types", value: gts.data.length, note: `${gts.data.filter((g) => g.active).length} available at the counter`, icon: Shirt, tone: "border-blue-100 bg-blue-50 text-blue-700" },
          { label: "Services", value: svcs.data.length, note: `${svcs.data.filter((s) => s.active).length} active services`, icon: Sparkles, tone: "border-violet-100 bg-violet-50 text-violet-700" },
          { label: "Prices set", value: configuredPrices, note: `of ${totalPrices} garment & service pairs`, icon: Tag, tone: "border-brand-100 bg-brand-50 text-brand-700" },
          { label: "Price lists", value: lists.data.length, note: "Store-wide and branch-specific", icon: Layers3, tone: "border-emerald-100 bg-emerald-50 text-emerald-700" },
        ].map(({ label, value, note, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-slate-500">{label}</p>
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl border", tone)}><Icon className="h-[18px] w-[18px]" /></span>
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-end">
          <Field label="Price list" hint="Choose which branch's prices to view or edit.">
            <Select value={listId} onChange={(e) => setListId(e.target.value)} disabled={!lists.data.length}>
              {lists.data.length === 0 && <option value="">No price lists created</option>}
              {lists.data.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.branchId ? `· ${session.branches.find((b) => b.id === l.branchId)?.name ?? "Branch"}` : "· All branches"}
                </option>
              ))}
            </Select>
          </Field>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Find a garment</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or category…" className="pl-9" />
            </span>
          </label>
          <Field label="Garment category">
            <Select value={garmentCategory} onChange={(e) => setGarmentCategory(e.target.value)}>
              <option value="">All categories</option>
              {garmentCategories.map((category) => <option key={category}>{category}</option>)}
            </Select>
          </Field>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Find a service</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Search service name or code…" className="pl-9" />
            </span>
          </label>
          <Field label="Service category">
            <Select value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value)}>
              <option value="">All categories</option>
              {serviceCategories.map((category) => <option key={category}>{category}</option>)}
            </Select>
          </Field>
          {canManage && <Button variant="secondary" onClick={() => setModal("list")}><Plus className="h-4 w-4" /> Branch price list</Button>}
        </div>
        {lists.data.length === 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Create a price list before adding prices. Use <span className="font-semibold">Branch price list</span> to set up a list for a specific location.
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Price matrix</h2>
          <p className="mt-0.5 text-sm text-slate-500">{canManage ? "Select any price to edit the amount and GST rate." : "Prices are read-only for your role."}</p>
        </div>
        {listId && <Badge color="brand">{lists.data.find((l) => l.id === listId)?.name ?? "Selected price list"}</Badge>}
      </div>
      {err && <Alert>{err}</Alert>}
      {ok && <Alert tone="green" onClose={() => setOk("")}>{ok}</Alert>}
      {visibleGarments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
          <Search className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-800">No garment types found</p>
          <p className="mt-1 text-sm text-slate-500">Try another search or add a new garment type.</p>
        </div>
      ) : (
      <Card padded={false} className="overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-20 min-w-56 border-r border-slate-200 bg-slate-50 px-4 py-3">Garment type</th>
                {activeSvcs.map((s) => (
                  <th key={s.id} className="min-w-36 px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {s.name}
                      {canManage && <button className="rounded p-1 transition hover:text-brand-700" onClick={() => setModal({ editService: s })} title="Edit service details" aria-label={`Edit ${s.name}`}><Pencil className="h-3 w-3 opacity-50" /></button>}
                    </span>
                    {!s.active && <Badge className="ml-1">Off</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleGarments.map((g) => (
                <tr key={g.id} className="group transition hover:bg-slate-50/70">
                  <td className="sticky left-0 z-[1] border-r border-slate-100 bg-white px-4 py-3 group-hover:bg-slate-50">
                    <div className="flex min-w-48 items-center gap-3">
                      <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50", !g.active && "opacity-50 grayscale")}><GarmentThumb garment={g} className="p-0.5" /></span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800">{g.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{g.category}</span>
                      </span>
                      {canManage && <button type="button" className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => setModal({ editGarment: g })} aria-label={`Edit ${g.name}`}><Pencil className="h-3.5 w-3.5" /></button>}
                      {canManage && <button type="button" className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={() => toggleGarment(g)}>{g.active ? "Disable" : "Enable"}</button>}
                    </div>
                  </td>
                  {activeSvcs.map((s) => (
                    <td key={s.id} className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <PriceCell price={priceFor(g.id, s.id)} disabled={!listId || !canManage} onSave={(v, tax, effectiveFrom) => setPrice(g, s, v, tax, effectiveFrom)} />
                        <button disabled={!listId} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setModal({ history: { garmentTypeId: g.id, serviceId: s.id } })} title={`View price history for ${g.name} / ${s.name}`} aria-label={`View price history for ${g.name} / ${s.name}`}><History className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="divide-y divide-slate-100 md:hidden">
          {visibleGarments.map((g) => (
            <li key={g.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-100 bg-slate-50", !g.active && "opacity-50 grayscale")}><GarmentThumb garment={g} className="p-0.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{g.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{g.category}</span>
                </span>
                <div className="flex items-center gap-2">
                  {canManage && <Button size="sm" variant="secondary" onClick={() => setModal({ editGarment: g })}>Edit</Button>}
                  {canManage && <button type="button" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600" onClick={() => toggleGarment(g)}>{g.active ? "Disable" : "Enable"}</button>}
                </div>
              </div>
              <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60">
                {activeSvcs.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-700">{s.name}{!s.active && <span className="ml-1 text-[10px] font-normal text-slate-400">(off)</span>}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">GST included per price</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <PriceCell mobile price={priceFor(g.id, s.id)} disabled={!listId || !canManage} onSave={(v, tax, effectiveFrom) => setPrice(g, s, v, tax, effectiveFrom)} />
                      <button disabled={!listId} className="rounded p-1 text-slate-400 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setModal({ history: { garmentTypeId: g.id, serviceId: s.id } })} aria-label={`View price history for ${g.name} / ${s.name}`}><History className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      )}
      <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
        <p>GST defaults to 18% for laundry and dry-cleaning services. Confirm the SAC code and applicable rate with your accountant. Price changes apply to new orders only.</p>
      </div>

      {modal === "garment" && (
        <AddGarmentForm
          categories={[...new Set(gts.data.map((g) => g.category))]}
          services={svcs.data.filter((sv) => sv.active)}
          listId={listId}
          onClose={() => setModal(null)}
          onSaved={() => { gts.reload(); prices.reload(); setModal(null); setOk("Garment added. It is now available at the counter."); }}
        />
      )}
      {modal && typeof modal === "object" && "editGarment" in modal && (
        <GarmentForm garment={modal.editGarment} categories={[...new Set(gts.data.map((g) => g.category))]} onClose={() => setModal(null)} onSaved={() => (gts.reload(), setModal(null))} />
      )}
      {modal === "list" && (
        <SimpleForm
          title="Branch-specific price list"
          fields={[["name", "Name", "Branch prices"]]}
          extra={(v, set) => (
            <>
              <Field label="Branch">
                <Select value={v.branchId ?? ""} onChange={(e) => set({ ...v, branchId: e.target.value })}>
                  <option value="">Select…</option>
                  {session.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Effective from" hint="Leave blank to make this list effective immediately.">
                <Input type="datetime-local" value={v.effectiveFrom ?? ""} onChange={(e) => set({ ...v, effectiveFrom: e.target.value })} />
              </Field>
            </>
          )}
          onClose={() => setModal(null)}
          onSubmit={(v) => api("/price-lists", { body: { ...v, effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom).toISOString() : undefined } }).then((l) => (lists.reload(), setListId(l.id), setModal(null)))}
        />
      )}
      {modal === "service" && (
        <ServiceForm categories={[...new Set(svcs.data.map((sv) => sv.category))]} onClose={() => setModal(null)} onSaved={() => (svcs.reload(), setModal(null))} />
      )}
      {modal && typeof modal === "object" && "editService" in modal && (
        <ServiceForm service={modal.editService} categories={[...new Set(svcs.data.map((sv) => sv.category))]} onClose={() => setModal(null)} onSaved={() => (svcs.reload(), setModal(null))} />
      )}
      {modal && typeof modal === "object" && "history" in modal && <PriceHistoryModal listId={listId} pair={modal.history} onClose={() => setModal(null)} />}
    </div>
  );
}

/** Offers the built-in garment list (with starting prices) to stores that do not have all of it yet. */
function StandardCatalogueBanner({ onInstalled }: { onInstalled: (message: string) => void }) {
  const standard = useApi<{ available: number; recategorise: number; categories: string[] }>("/catalogue/standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!standard.data || (!standard.data.available && !standard.data.recategorise)) return null;
  const { available, recategorise } = standard.data;
  async function install() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ added: number; prices: number; moved: number; services: number }>("/catalogue/standard", { body: {} });
      onInstalled([
        r.added ? `${r.added} garments added with ${r.prices} starting prices` : null,
        r.moved ? `${r.moved} garments organised into the new categories` : null,
        r.services ? `${r.services} new service${r.services === 1 ? "" : "s"} added (Repair & special care)` : null,
      ].filter(Boolean).join(" · ") + ". Change any price by clicking it in the price matrix.");
      standard.reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-white p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white"><Sparkles className="h-5 w-5" /></span>
      <div className="min-w-[14rem] flex-1">
        <p className="text-sm font-semibold text-slate-900">{available ? `${available} more ready-made garments available` : "Organise your garments into the new categories"}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-600">
          {available ? `Add the DryCare standard list${standard.data.categories.length ? ` (${standard.data.categories.join(", ")})` : ""} with typical starting prices and pictures. ` : ""}
          {recategorise ? `${recategorise} standard garment${recategorise === 1 ? "" : "s"} will move into the new categories (e.g. Woollens → Men / Accessories). ` : ""}
          Your prices and anything you renamed or re-categorised yourself are not changed.
        </p>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>
      <Button onClick={install} loading={busy}>{available ? `Add ${available} garments` : `Organise ${recategorise} garments`}</Button>
    </div>
  );
}

function GarmentForm({ garment, categories, onClose, onSaved }: { garment: any; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(garment.name);
  const [category, setCategory] = useState(garment.category);
  const [active, setActive] = useState(garment.active);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [artKey, setArtKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function save() {
    setErr("");
    setSaving(true);
    try {
      await api(`/garment-types/${garment.id}`, { method: "PATCH", body: { name, category, active } });
      if (imageFile) {
        const encoded = await readImageFile(imageFile);
        await api(`/garment-types/${garment.id}/image`, {
          method: "PUT",
          body: { mimeType: imageFile.type, data: encoded },
        });
      } else if (artKey) {
        await api(`/garment-types/${garment.id}/image`, {
          method: "PUT",
          body: { mimeType: "image/png", data: await garmentArtPng(artKey) },
        });
      } else if (removeImage && garment.hasImage) {
        await api(`/garment-types/${garment.id}/image`, { method: "DELETE" });
      }
      onSaved();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open title="Edit garment type" onClose={onClose} footer={<Button onClick={save} loading={saving} disabled={!name.trim() || !category.trim()}>Save changes</Button>}>
      {err && <Alert>{err}</Alert>}
      <Field label="Garment name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Category" hint="Pick a category or create a new one. The POS filters use these categories."><CategoryPicker value={category} options={categories} onChange={setCategory} /></Field>
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 p-1.5">
          <img src={imagePreview || (artKey ? garmentArtUrl(artKey) : garment.hasImage && !removeImage ? `/api/v1/garment-types/${garment.id}/image` : garmentArtUrl(matchGarmentArt(name, category)))} alt={`${name} preview`} className="h-full w-full object-contain" />
        </span>
        <div className="min-w-0 flex-1 text-xs text-slate-500">
          <p className="font-semibold text-slate-800">{imageFile ? "New photo" : artKey ? "Library picture" : garment.hasImage && !removeImage ? "Saved picture" : "Automatic picture"}</p>
          <p className="mt-0.5">{imageFile || artKey ? "Saved when you click Save changes." : garment.hasImage && !removeImage ? "Shown on the POS counter and catalogue." : "Matched from the garment name. Pick another below or upload a photo."}</p>
          {(garment.hasImage && !removeImage) || imageFile || artKey ? <Button className="mt-2" variant="secondary" size="sm" onClick={() => { setRemoveImage(true); setImageFile(null); setArtKey(null); }}>Use automatic picture</Button> : null}
        </div>
      </div>
      <Field label="Picture library" hint="Choose a built-in illustration for this garment.">
        <div className="grid max-h-56 grid-cols-5 gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-1.5 sm:grid-cols-6" role="listbox" aria-label="Garment pictures">
          {GARMENT_ART_OPTIONS.map((option) => (
            <button key={option.key} type="button" role="option" aria-selected={artKey === option.key} title={option.label} onClick={() => { setArtKey(option.key); setImageFile(null); setRemoveImage(false); setErr(""); }} className={cx("flex flex-col items-center gap-0.5 rounded-lg border p-1 text-[10px] font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50", artKey === option.key ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-transparent")}>
              <img src={garmentArtUrl(option.key)} alt="" className="h-10 w-10" />
              <span className="w-full truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Or upload a photo" hint="JPG, PNG or WebP · maximum 600 KB">
        <Input type="file" accept="image/jpeg,image/png,image/webp" className="px-2 py-1.5 text-xs" onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 600_000)) {
            setErr("Choose a JPG, PNG or WebP image smaller than 600 KB.");
            event.target.value = "";
            setImageFile(null);
            return;
          }
          setErr("");
          setImageFile(file);
          setArtKey(null);
          setRemoveImage(false);
        }} />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available for new orders</label>
    </Modal>
  );
}

function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read the selected image."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function PriceHistoryModal({ listId, pair, onClose }: { listId: string; pair: { garmentTypeId: string; serviceId: string }; onClose: () => void }) {
  const history = useApi<any[]>(`/price-lists/${listId}/prices/history?garmentTypeId=${pair.garmentTypeId}&serviceId=${pair.serviceId}`);
  return (
    <Modal open wide title="Price history" onClose={onClose}>
      {history.error && <Alert>{history.error.message}</Alert>}
      {!history.data && !history.error && <Spinner />}
      {history.data?.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No price history recorded for this item.</p>}
      {!!history.data?.length && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500"><th className="px-3 py-2">Price</th><th className="px-3 py-2">GST</th><th className="px-3 py-2">Effective from</th><th className="px-3 py-2">Effective to</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.data.map((row: any) => (
                <tr key={row.id}><td className="px-3 py-2 font-medium tabular-nums">{money(row.unitPrice)}</td><td className="px-3 py-2">{row.taxBps / 100}%</td><td className="px-3 py-2">{dateTime(row.effectiveFrom)}</td><td className="px-3 py-2">{row.effectiveTo ? dateTime(row.effectiveTo) : "Current"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PriceCell({ price, onSave, mobile = false, disabled = false }: { price: any; onSave: (v: string, taxBps: number, effectiveFrom?: string) => void; mobile?: boolean; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const [tax, setTax] = useState("18");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  if (!editing)
    return (
      mobile ? (
      <button
        type="button"
        disabled={disabled}
        className={cx("rounded-lg px-2.5 py-1.5 text-right transition", disabled ? "cursor-not-allowed text-slate-300" : "hover:bg-brand-50")}
        title={disabled ? "Create a price list to set prices" : "Click to edit price and GST"}
        onClick={() => {
          setV(price ? (price.unitPrice / 100).toFixed(2) : "");
          setTax(price ? String(price.taxBps / 100) : "18");
          setEditing(true);
        }}
      >
        <span className={cx("block text-sm font-semibold tabular-nums", price ? "text-slate-800" : "text-brand-700")}>{price ? money(price.unitPrice) : "Set price"}</span>
        {price && <span className="block text-[10px] text-slate-400">{price.taxBps / 100}% GST</span>}
      </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          title={disabled ? "Create a price list to set prices" : "Click to edit price and GST"}
          className={cx("rounded-lg px-2.5 py-1.5 tabular-nums transition", disabled ? "cursor-not-allowed text-slate-300" : "hover:bg-brand-50")}
          onClick={() => {
            setV(price ? (price.unitPrice / 100).toFixed(2) : "");
            setTax(price ? String(price.taxBps / 100) : "18");
            setEditing(true);
          }}
        >
          {price ? <><span className="font-medium text-slate-800">{money(price.unitPrice)}</span><span className="ml-1.5 text-[10px] text-slate-400">{price.taxBps / 100}%</span></> : <span className={disabled ? "text-slate-300" : "text-brand-700"}>+ Set price</span>}
        </button>
      )
    );
  return (
    mobile ? (
    <form
      className="grid w-44 grid-cols-[1fr_auto] gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v, Math.round(Number(tax) * 100), effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined);
        setEditing(false);
      }}
    >
      <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="min-w-0 px-2 py-1.5 text-right" aria-label="Price in rupees" placeholder="Price ₹" inputMode="decimal" />
      <Input value={tax} onChange={(e) => setTax(e.target.value)} className="w-14 px-1 py-1.5 text-right" aria-label="GST percentage" title="GST percentage" inputMode="decimal" />
      <Input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="col-span-2 min-w-0 px-2 py-1.5" aria-label="Price effective from" title="Leave blank to apply immediately" />
      <Button size="sm" type="submit" className="h-8"><Check className="h-3.5 w-3.5" /><span className="sr-only">Save price</span></Button>
      <Button size="sm" variant="secondary" type="button" className="h-8 px-2" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" /><span className="sr-only">Cancel editing</span></Button>
    </form>
    ) : (
      <form
        className="flex items-center justify-end gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(v, Math.round(Number(tax) * 100), effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined);
          setEditing(false);
        }}
      >
        <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="w-20 px-2 py-1 text-right" aria-label="Price in rupees" inputMode="decimal" />
        <Input value={tax} onChange={(e) => setTax(e.target.value)} className="w-12 px-1 py-1 text-right" aria-label="GST percentage" title="GST percentage" inputMode="decimal" />
        <Input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="w-44 px-2 py-1" aria-label="Price effective from" title="Leave blank to apply immediately" />
        <Button size="sm" type="submit" aria-label="Save price">
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" type="button" aria-label="Cancel editing" onClick={() => setEditing(false)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </form>
    )
  );
}

function SimpleForm({ title, fields, onClose, onSubmit, extra }: { title: string; fields: [string, string, string][]; onClose: () => void; onSubmit: (v: any) => Promise<unknown>; extra?: (v: any, set: (v: any) => void) => React.ReactNode }) {
  const [v, setV] = useState<any>(Object.fromEntries(fields.map(([k, , d]) => [k, d])));
  const [err, setErr] = useState("");
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <Button onClick={() => onSubmit(v).catch((e: ApiError) => setErr(e.message))} disabled={fields.some(([k]) => !String(v[k] ?? "").trim())}>
          Save
        </Button>
      }
    >
      {err && <Alert>{err}</Alert>}
      {fields.map(([k, label]) => (
        <Field key={k} label={label}>
          <Input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </Field>
      ))}
      {extra?.(v, setV)}
    </Modal>
  );
}

const PROCESS_PRESETS: { key: string; label: string; detail: string; stages: string[] }[] = [
  { key: "dry_clean", label: "Dry clean", detail: "Inspect, clean, finish, check and pack", stages: ["received", "inspection", "sorting", "cleaning", "drying", "finishing", "quality_control", "packing", "ready"] },
  { key: "laundry", label: "Wash & iron", detail: "Sort, wash, dry, iron, check and pack", stages: ["received", "sorting", "cleaning", "drying", "finishing", "quality_control", "packing", "ready"] },
  { key: "press", label: "Ironing / steam press", detail: "Press, check and pack", stages: ["received", "finishing", "quality_control", "packing", "ready"] },
  { key: "quick", label: "Quick (no checks)", detail: "Process and hand over", stages: ["received", "cleaning", "finishing", "ready"] },
];

function serviceCodeFrom(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  const code = (initials.length >= 2 ? initials : words.join("")).slice(0, 6);
  return code.length >= 2 ? code : "SVC";
}

function ServiceForm({ service, categories, onClose, onSaved }: { service?: any; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? categories[0] ?? "Dry Clean");
  const [code, setCode] = useState(service?.serviceCode ?? "");
  const [unit, setUnit] = useState(service?.unitType ?? "per_piece");
  const [active, setActive] = useState(service?.active ?? true);
  const [stages, setStages] = useState<string[]>(service?.workflowStages ?? PROCESS_PRESETS[0].stages);
  const [advanced, setAdvanced] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const preset = PROCESS_PRESETS.find((p) => p.stages.length === stages.length && p.stages.every((st) => stages.includes(st)));
  const finalCode = service ? service.serviceCode : (code || serviceCodeFrom(name));

  async function save() {
    setErr("");
    setSaving(true);
    const ordered = PROCESS_STAGES.filter((st) => st === "received" || st === "ready" || stages.includes(st));
    const body = { name: name.trim(), category: category.trim(), serviceCode: finalCode, unitType: unit, workflowStages: ordered, active };
    try {
      if (service) await api(`/services/${service.id}`, { method: "PATCH", body });
      else await api("/services", { body });
      onSaved();
    } catch (e) {
      const error = e as ApiError;
      setErr(error.code === "CONFLICT" || /code/i.test(error.message) ? `${error.message} Open "More options" and choose a different short code.` : error.message);
      if (/code/i.test(error.message)) setAdvanced(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open wide title={service ? `Edit ${service.name}` : "Add service"} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!name.trim() || !category.trim()}>{service ? "Save changes" : "Add service"}</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service name" required hint="What customers see on the bill, e.g. Dry clean, Wash & fold, Steam press">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dry clean" autoFocus={!service} />
        </Field>
        <Field label="Category" hint="Groups services at the counter">
          <CategoryPicker value={category} options={categories} onChange={setCategory} />
        </Field>
        <Field label="How is it priced?">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="per_piece">Per piece (each garment gets a tag)</option>
            <option value="per_pair">Per pair (e.g. shoes, socks)</option>
            <option value="per_kg">By weight, per kg (one tag per bag)</option>
            <option value="per_package">Per package / bundle (one tag per bag)</option>
          </Select>
        </Field>
        {service && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brand-700" /> Offered at the counter
          </label>
        )}
      </div>
      <Field label="Work steps in the shop" hint="Choose what happens to each garment. Staff move garments through these steps on the production board.">
        <div className="grid gap-2 sm:grid-cols-2">
          {PROCESS_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setStages(p.stages)} className={cx("rounded-xl border p-3 text-left transition", preset?.key === p.key ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 hover:border-brand-300")}>
              <span className="block text-sm font-semibold text-slate-900">{p.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{p.detail}</span>
            </button>
          ))}
        </div>
      </Field>
      <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setAdvanced((v) => !v)}>{advanced ? "Hide more options" : "More options"}</button>
      {advanced && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <Field label="Short code" hint={service ? "Cannot be changed after the service is created." : "Printed on tags and reports. Created automatically from the name; change it only if it clashes."}>
            <Input value={finalCode} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 12))} disabled={!!service} className="w-40 font-mono" />
          </Field>
          <Field label="Custom work steps" hint="Received and Ready are always included. Keep Quality control to require an inspection before release.">
            <div className="flex flex-wrap gap-2">
              {PROCESS_STAGES.map((st) => {
                const fixed = st === "received" || st === "ready";
                return (
                  <label key={st} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm">
                    <input type="checkbox" disabled={fixed} checked={fixed || stages.includes(st)} onChange={(e) => setStages(e.target.checked ? [...stages, st] : stages.filter((x) => x !== st))} />
                    {STAGE_LABELS[st as GarmentStage]}
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Choose an existing category, or switch to typing a new one. */
function CategoryPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  const sorted = [...new Set(options.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const [creating, setCreating] = useState(Boolean(value) && !sorted.includes(value));
  if (creating || !sorted.length) {
    return (
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="New category, e.g. Kids" maxLength={40} autoFocus={creating} />
        {sorted.length > 0 && <Button type="button" variant="secondary" onClick={() => { setCreating(false); onChange(sorted[0]); }}>Choose</Button>}
      </div>
    );
  }
  return (
    <Select value={value} onChange={(e) => { if (e.target.value === "__new") { setCreating(true); onChange(""); } else onChange(e.target.value); }}>
      {sorted.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__new">+ New category…</option>
    </Select>
  );
}

function AddGarmentForm({ categories, services, listId, onClose, onSaved }: { categories: string[]; services: any[]; listId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories.includes("Men") ? "Men" : categories[0] ?? "General");
  const [artKey, setArtKey] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!imageFile) return setPreview("");
    const url = URL.createObjectURL(imageFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function save() {
    setErr("");
    setSaving(true);
    try {
      const garment = await api<any>("/garment-types", { body: { name: name.trim(), category: category.trim() || "General" } });
      if (imageFile) {
        await api(`/garment-types/${garment.id}/image`, { method: "PUT", body: { mimeType: imageFile.type, data: await readImageFile(imageFile) } });
      } else if (artKey) {
        await api(`/garment-types/${garment.id}/image`, { method: "PUT", body: { mimeType: "image/png", data: await garmentArtPng(artKey) } });
      }
      const priced = services.filter((sv) => Number(priceInputs[sv.id]) > 0);
      for (const sv of priced) {
        await api(`/price-lists/${listId}/prices`, { body: { garmentTypeId: garment.id, serviceId: sv.id, unitPrice: rupeesToPaise(priceInputs[sv.id]), taxBps: 1800 } });
      }
      onSaved();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  const autoKey = matchGarmentArt(name || "garment", category);
  return (
    <Modal open wide title="Add garment" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} disabled={!name.trim()}>Add garment</Button></>}>
      {err && <Alert>{err}</Alert>}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[120px_1fr]">
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <img src={preview || garmentArtUrl(artKey ?? autoKey)} alt="" className="h-full w-full object-contain" />
          </span>
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setShowLibrary((v) => !v)}>Change picture</button>
        </div>
        <div className="space-y-4">
          <Field label="Garment name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sherwani, Saree, Blanket (double)" autoFocus /></Field>
          <Field label="Category" hint="Shown as a filter at the POS counter"><CategoryPicker value={category} options={[...categories, "Men", "Women", "Kids", "Household", "Footwear"]} onChange={setCategory} /></Field>
        </div>
      </div>
      {showLibrary && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="grid max-h-48 grid-cols-6 gap-1.5 overflow-y-auto sm:grid-cols-8">
            {GARMENT_ART_OPTIONS.map((o) => (
              <button key={o.key} type="button" title={o.label} onClick={() => { setArtKey(o.key); setImageFile(null); }} className={cx("flex flex-col items-center rounded-lg border p-1 text-[10px] text-slate-600", artKey === o.key ? "border-brand-600 bg-brand-50" : "border-transparent hover:bg-slate-50")}>
                <img src={garmentArtUrl(o.key)} alt="" className="h-9 w-9" /><span className="w-full truncate">{o.label}</span>
              </button>
            ))}
          </div>
          <Field label="Or upload a photo" hint="JPG, PNG or WebP · maximum 600 KB">
            <Input type="file" accept="image/jpeg,image/png,image/webp" className="px-2 py-1.5 text-xs" onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 600_000)) { setErr("Choose a JPG, PNG or WebP image smaller than 600 KB."); e.target.value = ""; return; }
              setImageFile(file);
              setArtKey(null);
            }} />
          </Field>
        </div>
      )}
      {listId && services.length > 0 && (
        <Field label="Price for each service (₹)" hint="Leave a service blank if you don't offer it for this garment. You can change prices any time in the price matrix.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((sv) => (
              <label key={sv.id} className="block rounded-xl border border-slate-200 p-2.5">
                <span className="block text-xs font-semibold text-slate-600">{sv.name}</span>
                <Input inputMode="decimal" value={priceInputs[sv.id] ?? ""} onChange={(e) => setPriceInputs({ ...priceInputs, [sv.id]: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="—" className="mt-1 h-9" />
              </label>
            ))}
          </div>
        </Field>
      )}
    </Modal>
  );
}

"use client";
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { FEATURES, type FeatureKey } from "@drycare/shared";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui";

/** Shown in place of a screen a shop may not use. An upgrade is offered only when an upgrade would actually help. */
export function FeatureLocked({ feature }: { feature: FeatureKey }) {
  const { session, can } = useSession();
  const def = FEATURES[feature];
  const lock = session.featureLocks?.[feature];
  const canUpgrade = lock?.reason === "plan" && lock.plans.length > 0 && can("org.manage");
  const line =
    lock?.reason === "admin" ? "This has been turned off for your business. Please contact Drycare support if you need it."
    : lock?.reason === "global" ? "This is not available at the moment."
    : lock?.reason === "license" ? "This is not included in your license. Please contact Drycare support to add it."
    : lock?.reason === "addon" ? "This is sold separately. Please contact Drycare support to add it."
    : lock?.currentPlan ? `This is not included in your ${lock.currentPlan} plan.`
    : "This is not included in your plan.";
  return (
    <section aria-labelledby="locked-h" className="mx-auto mt-10 max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-700"><Lock aria-hidden="true" className="h-6 w-6" /></span>
      <h1 id="locked-h" className="dcd-h mt-4 text-2xl text-slate-900">{lock?.label || def.label}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{lock?.message || lock?.description || def.description}</p>
      <p className="mt-4 text-sm font-semibold text-slate-900">{line}</p>
      {lock?.reason === "plan" && lock.plans.length > 0 && <p className="mt-1 text-sm text-slate-600">{`Available in: ${lock.plans.join(", ")}`}</p>}
      {canUpgrade && <Link href="/billing" className="mt-5 inline-block"><Button size="lg"><Sparkles className="h-4 w-4" />Upgrade plan</Button></Link>}
    </section>
  );
}

/** The owner's referral offer: what is on, and what a shop pays with it. The server decides every discounted amount. */
import { eq } from "drizzle-orm";
import { DEFAULT_REFERRAL_OFFER, REFERRAL_INTERVALS, referralLive, referralPrice, sameReferralCode, type ReferralOffer } from "@drycare/shared";
import { db, schema, type DbOrTx } from "../db/client";
import { planOffer } from "./commercialInvoice";
import { unprocessable } from "./errors";

export const REFERRAL_KEY = "referral_offer";

export async function readReferralOffer(tx: DbOrTx = db): Promise<ReferralOffer> {
  const row = await tx.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, REFERRAL_KEY) });
  return (row?.value as unknown as ReferralOffer | undefined)?.code ? (row!.value as unknown as ReferralOffer) : DEFAULT_REFERRAL_OFFER;
}

type Plan = { pricePaise: number; gstInclusive: boolean; currency: string; interval: string };

/** What this shop pays for this plan with this code. Refuses, with the reason, if the code does not apply. */
export async function applyReferral(raw: string, plan: Plan, org: Parameters<typeof planOffer>[1], gstRateBps: number) {
  const offer = await readReferralOffer();
  const refuse = (message: string) => unprocessable(message, "REFERRAL_NOT_VALID");
  if (!sameReferralCode(raw, offer.code)) throw refuse("That referral code is not valid.");
  if (!referralLive(offer)) throw refuse("That referral code has ended.");
  if (!REFERRAL_INTERVALS.includes(plan.interval)) throw refuse("This referral code works on quarterly and yearly plans only.");
  const full = planOffer(plan, org, gstRateBps);
  if (!full.india) throw refuse("This referral code is for customers in India.");
  const discounted = planOffer({ ...plan, pricePaise: referralPrice(plan.pricePaise, offer.percent) }, org, gstRateBps);
  return { code: offer.code, percent: offer.percent, payablePaise: discounted.payablePaise, discountPaise: full.payablePaise - discounted.payablePaise, currency: discounted.currency };
}

/** A referral code the software owner runs for a limited time. It takes a percentage off quarterly and yearly plans. */
export type ReferralOffer = { code: string; percent: number; endsOn: string; active: boolean };

export const DEFAULT_REFERRAL_OFFER: ReferralOffer = { code: "AIDCexchange", percent: 5, endsOn: "2026-12-31", active: true };
/** Only plans paid in advance get the discount. */
export const REFERRAL_INTERVALS = ["quarter", "year"];

/** Today in India, where this offer runs, as YYYY-MM-DD. The last day counts in full. */
export const indiaToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
export const referralLive = (o: ReferralOffer, now = new Date()) => o.active && indiaToday(now) <= o.endsOn;
export const sameReferralCode = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
/** The price after the discount, in whole paise. */
export const referralPrice = (pricePaise: number, percent: number) => Math.round((pricePaise * (100 - percent)) / 100);

# DryCare Phase 4 — Stage A review (analysis only, nothing implemented)

Date: 29 Oct 2026 · Status: **for owner approval**. Cloud pull, multi-branch reports and numbering changes are **not** built. Separate approval is required, and the Phase 3 prerequisite below must be met first.

## 1. Prerequisite: Phase 3 status

| Requirement | Status |
|---|---|
| Push sync, linking, revocation, conflicts, staged commits | Built (v0.1.8 + readiness fixes, migrations 0028–0029) |
| Automated integration test (local test cloud, simulated network) | Passing (`pnpm cloud-sync-test`) |
| Real Windows app → local dev cloud, end to end | Passed once (847 changes, no conflicts) |
| **Real Windows install → hosted production cloud** | **Not done: no cloud is hosted yet** |

The Phase 4 brief requires Phase 3 to have passed real integration tests. That needs the hosted environment (see `DESKTOP_CLOUD_PLAN.md` §8.5 and §9). Until then, Phase 4 stays at this analysis stage.

## 2. Entity ownership matrix (proposed rules for cloud → PC pull)

"Owner" is who may change the record. Pull = what a PC would receive from the cloud. All server-side checks use the device's organisation and branch, never ids supplied by the client.

| Group | Tables | Owner | Pull to a PC | Conflict rule |
|---|---|---|---|---|
| Business identity | `organizations`, `branches` | Owner (cloud web or main PC) | All branches of the business (read) | Field merge for name/address/settings; GSTIN and legal name changes require owner confirmation on the PC |
| People and access | `users`, `roles`, `organization_memberships`, `staff_profiles` | Each PC for its own staff; cloud for cloud users | **Not pulled** (logins stay local; cloud users never become PC logins) | n/a |
| Shared master data | `customers`, `customer_addresses`, `services`, `garment_types`, `price_lists`, `service_prices`, `laundry_services`, `laundry_pricing_rules`, `laundry_item_rates`, `laundry_programs`, `inventory_items`, `suppliers`, `marketing_campaigns`, `marketing_coupons` | Business-wide; any authorised branch | Yes, all branches | Version or `updated_at` + field-level comparison; when the same field was edited differently on both sides, it goes to a conflict list for owner review (no automatic winner). Branch price lists apply only to their branch |
| Branch transactions (money) | `orders`, `order_items`, `invoices`, `laundry_orders`, `purchase_orders`, `purchase_order_lines`, `expenses`, `cashier_shifts`, `claims` | **Issuing branch only** | Other branches: **read-only** copies (for lookup and collection at another branch: see open question Q8) | The cloud never accepts an edit to another branch's transaction; never last-write-wins |
| Branch operations | `garments`, `bags`, `transfer_batches`, `transfer_batch_bags`, `garment_exceptions`, `pickup_deliveries`, `delivery_items`, `rework_records`, `customer_approvals`, `storage_locations`, `laundry_*` machines, sessions and maintenance, `staff_attendance`, `staff_leaves` | Branch holding the garment or asset | Only where needed (garments in transit between branches) | Version column (`garments`, `pickup_deliveries`, `laundry_machines`); stale updates refused |
| Ledgers (append-only) | `payments`, `payment_allocations`, `refunds`, `credit_notes`, `invoice_items`, `customer_wallet_entries`, `inventory_movements`, `garment_status_history`, `quality_inspections`, `scan_events`, `delivery_events`, `claim_events`, `marketing_coupon_redemptions` | Branch that wrote them | Read-only copies where the parent record is pulled; **wallet entries pulled for every branch** (shared wallet balance) | Insert-if-absent by id; same id with different content is a conflict; never edited or deleted |
| Local only | sessions, login tokens, idempotency keys, number counters, notification and print queues, audit log, licences, platform billing, sync tables | — | Never | — |

The **shared wallet** is the hardest case. Two branches spending the same balance offline could overdraw it. The options are: (a) wallet spends only when online, (b) a per-branch spending allowance, or (c) accept an overdraw and record it as a receivable. This needs an owner decision.

## 3. Document-numbering inventory (as implemented today)

| Document | Format (example) | Counter scope | Year basis | Legally significant? | Offline multi-PC safe? |
|---|---|---|---|---|---|
| Tax invoice | `INV/2026/000123` (15 chars) | **Business-wide** | **Calendar year**, from the server clock | **Yes** (GST tax invoice, Rule 46) | **No**: two PCs would issue the same number |
| Credit note | `CN/2026/000001` | Business-wide | Calendar year | **Yes** (GST credit note, Rule 53) | No |
| Self-service laundry order / receipt | `SS-MN-2026-00012` | Per branch | Calendar year | Probably (it is the customer's bill) — **Q4** | Only if one PC per branch |
| Order (dry-clean job) | `MN-2026-00045` | Per branch | Calendar year | Internal (the invoice is the tax document) | Only if one PC per branch |
| Purchase order | `PO/2026/0007` | Business-wide | Calendar year | No (sent to the supplier) | No |
| Facility transfer batch | `OUT-2026-00003` / `RET-…` | Business-wide | Calendar year | Possibly, if it moves goods between GSTINs — **Q6** | No |
| Customer code | `C-00012` | Business-wide | — | No | No |
| Stock item code | `ITM-0004` | Business-wide | — | No | No |
| Claim | `CLM-00003` | Business-wide | — | No | No |
| Platform invoices to shops (DryCare's own billing) | global | Global (cloud only) | — | Yes (DryCare's own GST) | n/a (cloud only) |

All database ids are UUIDs, which are globally unique. All counters are allocated inside the same database transaction as the document, and orders and payments carry idempotency keys, so **a retry cannot issue a second number for the same document** today. Uniqueness is enforced per business (`organization_id`, number).

**Issues found, which need approval before anything changes:**

1. **Calendar year vs financial year.** GST invoice series are expected to be unique within a financial year (April–March). The current series restarts every 1 January.
2. **Server clock.** The year comes from the server's local time. On a cloud server running in UTC, documents issued between 00:00 and 05:30 IST on 1 January get the previous year. Shop PCs run in IST and are not affected.
3. **No GSTIN per branch.** GSTIN exists only per business. Branches in different states need their own GSTIN and their own invoice series.
4. **Business-wide counters on PCs.** Today this is safe only because Phase 3 allows one linked PC per business.

## 4. Proposal (for approval; not implemented)

* **Legal documents (invoices, credit notes, possibly laundry bills): one series per issuing PC within each branch and financial year.**
  * Format `{BRANCH}{DEVICE#}/{FY}/{NNNNN}`, e.g. `MN1/2627/00123` (14 characters, within the 16-character limit). FY `2627` means 1 Apr 2026 – 31 Mar 2027, computed in IST.
  * Each PC gets a small device number from the cloud when it is linked (or `1` for a standalone PC), so two PCs can never produce the same number, even offline.
  * The counter is assigned in the same transaction as the document (as today), so retries cannot duplicate it, and the series has no gaps on that PC. Cancelled invoices keep their number.
* **Existing numbers are never changed.** The new format starts from an agreed effective date, ideally 1 April (the start of a financial year), so no financial year mixes two styles. History, audit trail and backups are unchanged.
* **Internal codes** (customer, item, claim, PO, transfer) get a device prefix for new records (e.g. `C-MN1-00012`) once more than one PC is linked; existing codes stay.
* **Branch GSTIN:** add an optional GSTIN and state to each branch. A branch with its own GSTIN uses its own series and prints its own GSTIN on invoices.
* **Rejected alternative: cloud-leased number blocks.** They need the internet to obtain a block, and unused numbers leave gaps.

This proposal **does not by itself guarantee GST compliance.** It must be confirmed by a qualified accountant or tax professional (questions below).

## 5. Questions for a qualified accountant / tax professional

* **Q1.** Is the existing calendar-year reset of `INV/YYYY/` acceptable for past periods, or must anything be reported or explained (e.g. in GSTR-1 Table 13, "documents issued")?
* **Q2.** May the new series start mid-financial year, or must it start on 1 April?
* **Q3.** Is one series per PC (multiple series per branch) acceptable, and how should the series be listed in GSTR-1 Table 13?
* **Q4.** Are self-service laundry receipts tax invoices or bills of supply, and must they share the invoice series?
* **Q5.** Should credit notes follow the same per-PC series, and which reference to the original invoice must they carry?
* **Q6.** Do garment transfers between a branch and a facility with a different GSTIN need a delivery challan or tax invoice, and does that need its own series?
* **Q7.** For businesses above the e-invoicing (IRN) threshold, is IRN/QR generation required? DryCare does not support it today.
* **Q8.** Can a customer pay at branch B for an invoice issued by branch A (different GSTIN), and how should that receipt be recorded?
* **Q9.** What retention period applies to invoices and credit notes held in the cloud and on PCs?

## 6. What happens after approval

Stage B (cloud pull) and Stage C (multi-branch reports) can be built and tested against the local test cloud with two isolated test installations. Stage E (numbering) is built only after the proposal and the answers to Q1–Q9 are approved. Production use of any of it requires the hosted cloud and the real end-to-end test.

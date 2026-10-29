CREATE TABLE "customer_wallet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"payment_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_wallet_entries" ADD CONSTRAINT "customer_wallet_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_entries_customer_idx" ON "customer_wallet_entries" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_entries_org_idx" ON "customer_wallet_entries" USING btree ("organization_id");
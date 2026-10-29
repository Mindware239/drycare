-- FR-AUD-003 / FR-PAY-010: audit, workflow-history and ledger rows are append-only at the database level,
-- so even a buggy code path or a manual SQL session cannot silently rewrite history.
CREATE OR REPLACE FUNCTION drycare_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER garment_history_append_only BEFORE UPDATE OR DELETE ON garment_status_history FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER inspections_append_only BEFORE UPDATE OR DELETE ON quality_inspections FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER allocations_append_only BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION drycare_payment_guard() RETURNS trigger AS $$
BEGIN
  -- Only status (gateway confirmation) and customer_id (authorized customer merge) may change.
  IF NEW.amount <> OLD.amount OR NEW.payment_method <> OLD.payment_method OR NEW.organization_id <> OLD.organization_id
     OR NEW.payment_reference <> OLD.payment_reference OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'Payment ledger values are immutable; use a refund or adjustment' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION drycare_payment_guard();
--> statement-breakpoint
CREATE TRIGGER invoice_items_append_only BEFORE UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION drycare_forbid_change();

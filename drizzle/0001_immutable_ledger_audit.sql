-- Append-only enforcement: ledger and admin audit rows can never be modified or deleted.
CREATE OR REPLACE FUNCTION gop_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS coin_transactions_append_only ON coin_transactions;
--> statement-breakpoint
CREATE TRIGGER coin_transactions_append_only BEFORE UPDATE OR DELETE ON coin_transactions FOR EACH ROW EXECUTE FUNCTION gop_reject_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_append_only ON admin_audit_logs;
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_append_only BEFORE UPDATE OR DELETE ON admin_audit_logs FOR EACH ROW EXECUTE FUNCTION gop_reject_mutation();

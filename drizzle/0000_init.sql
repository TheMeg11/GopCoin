-- GOP Coin — mining economy schema. All coin amounts are stored as integer MILLI-GOP (1 GOP = 1000).
CREATE TABLE "account_restrictions" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "action" varchar(16) NOT NULL,
        "reason" text NOT NULL,
        "until" timestamp with time zone,
        "admin_telegram_id" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "admin_telegram_id" bigint NOT NULL,
        "action" varchar(48) NOT NULL,
        "target_user_id" integer,
        "details" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_deliveries" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "broadcast_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "status" varchar(16) DEFAULT 'pending' NOT NULL,
        "error" text,
        "sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" varchar(120) NOT NULL,
        "message" text NOT NULL,
        "button_text" varchar(40),
        "segment" varchar(24) DEFAULT 'all' NOT NULL,
        "status" varchar(16) DEFAULT 'draft' NOT NULL,
        "scheduled_at" timestamp with time zone,
        "total" integer DEFAULT 0 NOT NULL,
        "sent" integer DEFAULT 0 NOT NULL,
        "failed" integer DEFAULT 0 NOT NULL,
        "created_by" bigint NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coin_transactions" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "type" varchar(32) NOT NULL,
        "amount" bigint NOT NULL,
        "balance_after" bigint NOT NULL,
        "idempotency_key" varchar(128) NOT NULL,
        "source_ref" varchar(128),
        "reason" text,
        "admin_telegram_id" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "coin_tx_amount_nonzero" CHECK ("coin_transactions"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_orders" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "package_id" varchar(32) NOT NULL,
        "gop_amount" bigint NOT NULL,
        "usd_amount" numeric(12,2) NOT NULL,
        "asset_symbol" varchar(12) DEFAULT 'BNB' NOT NULL,
        "asset_amount" numeric(24,8) NOT NULL,
        "asset_usd_rate" numeric(14,2) NOT NULL,
        "address" varchar(96) NOT NULL,
        "tx_hash" varchar(128),
        "tx_from" varchar(96),
        "tx_value" numeric(24,8),
        "status" varchar(16) DEFAULT 'pending' NOT NULL,
        "note" text,
        "admin_telegram_id" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "decided_at" timestamp with time zone,
        CONSTRAINT "crypto_orders_gop_positive" CHECK ("crypto_orders"."gop_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "game_config" (
        "key" varchar(32) PRIMARY KEY NOT NULL,
        "value" jsonb NOT NULL,
        "version" integer DEFAULT 1 NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_by" bigint
);
--> statement-breakpoint
CREATE TABLE "referrals" (
        "id" serial PRIMARY KEY NOT NULL,
        "inviter_id" integer NOT NULL,
        "invitee_id" integer NOT NULL,
        "status" varchar(16) DEFAULT 'pending' NOT NULL,
        "source" varchar(16) DEFAULT 'miniapp' NOT NULL,
        "inviter_reward" integer,
        "invitee_reward" integer,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "activated_at" timestamp with time zone,
        CONSTRAINT "referrals_no_self" CHECK ("referrals"."inviter_id" <> "referrals"."invitee_id")
);
--> statement-breakpoint
CREATE TABLE "security_events" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "user_id" integer,
        "type" varchar(48) NOT NULL,
        "severity" integer DEFAULT 1 NOT NULL,
        "details" jsonb,
        "resolved" boolean DEFAULT false NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_claims" (
        "id" serial PRIMARY KEY NOT NULL,
        "task_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "status" varchar(16) NOT NULL,
        "reward" integer,
        "reviewed_by" bigint,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
        "id" serial PRIMARY KEY NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" text DEFAULT '' NOT NULL,
        "type" varchar(24) NOT NULL,
        "verification" varchar(24) NOT NULL,
        "url" text,
        "chat_id" varchar(64),
        "requirement_kind" varchar(24),
        "requirement_value" integer,
        "reward" integer DEFAULT 0 NOT NULL,
        "active" boolean DEFAULT true NOT NULL,
        "expires_at" timestamp with time zone,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
        "id" serial PRIMARY KEY NOT NULL,
        "telegram_id" bigint NOT NULL,
        "first_name" varchar(128) DEFAULT '' NOT NULL,
        "last_name" varchar(128),
        "username" varchar(64),
        "photo_url" text,
        "language_code" varchar(16),
        "referral_code" varchar(16) NOT NULL,
        "referred_by_id" integer,
        "balance" bigint DEFAULT 0 NOT NULL,
        "lifetime_earned" bigint DEFAULT 0 NOT NULL,
        "mine_earned" bigint DEFAULT 0 NOT NULL,
        "referral_earned" bigint DEFAULT 0 NOT NULL,
        "purchase_earned" bigint DEFAULT 0 NOT NULL,
        "collected_count" integer DEFAULT 0 NOT NULL,
        "xp" bigint DEFAULT 0 NOT NULL,
        "level" integer DEFAULT 1 NOT NULL,
        "referral_count" integer DEFAULT 0 NOT NULL,
        "mine_speed_tier" integer DEFAULT 0 NOT NULL,
        "mine_limit_tier" integer DEFAULT 0 NOT NULL,
        "mine_last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_settled_at" timestamp with time zone DEFAULT now() NOT NULL,
        "daily_mined" bigint DEFAULT 0 NOT NULL,
        "daily_mined_day" date,
        "status" varchar(16) DEFAULT 'active' NOT NULL,
        "suspended_until" timestamp with time zone,
        "status_reason" text,
        "flagged" boolean DEFAULT false NOT NULL,
        "risk_score" integer DEFAULT 0 NOT NULL,
        "can_message" boolean DEFAULT false NOT NULL,
        "bot_blocked" boolean DEFAULT false NOT NULL,
        "admin_note" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "users_balance_nonneg" CHECK ("users"."balance" >= 0),
        CONSTRAINT "users_counters_nonneg" CHECK ("users"."xp" >= 0 AND "users"."referral_count" >= 0 AND "users"."collected_count" >= 0),
        CONSTRAINT "users_mine_tiers" CHECK ("users"."mine_speed_tier" >= 0 AND "users"."mine_limit_tier" >= 0),
        CONSTRAINT "users_daily_mined_nonneg" CHECK ("users"."daily_mined" >= 0)
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
        "id" bigserial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "type" varchar(32) NOT NULL,
        "amount" integer NOT NULL,
        "idempotency_key" varchar(128) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "restrictions_user_idx" ON "account_restrictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deliveries_bc_status_idx" ON "broadcast_deliveries" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_bc_user_uq" ON "broadcast_deliveries" USING btree ("broadcast_id","user_id");--> statement-breakpoint
CREATE INDEX "coin_tx_type_created_idx" ON "coin_transactions" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "coin_tx_user_idx" ON "coin_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coin_tx_idem_uq" ON "coin_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "crypto_orders_status_idx" ON "crypto_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "crypto_orders_user_idx" ON "crypto_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_orders_tx_hash_uq" ON "crypto_orders" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invitee_uq" ON "referrals" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "referrals_inviter_idx" ON "referrals" USING btree ("inviter_id","status");--> statement-breakpoint
CREATE INDEX "referrals_activated_idx" ON "referrals" USING btree ("activated_at");--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_events_user_idx" ON "security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "task_claims_status_idx" ON "task_claims" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_claims_task_user_uq" ON "task_claims" USING btree ("task_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uq" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_id");--> statement-breakpoint
CREATE INDEX "users_lifetime_idx" ON "users" USING btree ("lifetime_earned");--> statement-breakpoint
CREATE INDEX "users_xp_idx" ON "users" USING btree ("xp");--> statement-breakpoint
CREATE INDEX "users_refcount_idx" ON "users" USING btree ("referral_count");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_events_idem_uq" ON "xp_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "xp_events_user_idx" ON "xp_events" USING btree ("user_id");
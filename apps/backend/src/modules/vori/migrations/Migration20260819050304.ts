import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260819050304 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "vori_sync_state" ("id" text not null, "watermark" text null, "next_watermark" text null, "cursor" text null, "last_error" text null, "last_run_at" timestamptz null, "last_run_products_updated" integer not null default 0, "last_run_records_seen" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "vori_sync_state_pkey" primary key ("id"));`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_vori_sync_state_deleted_at" ON "vori_sync_state" ("deleted_at") WHERE deleted_at IS NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "vori_sync_state" cascade;`)
  }
}

# Free KV backup archive

This archives the historical `fazatak_backups.backup_data` values to private Cloudflare Workers KV. It does not change active sync records in `fazatak_user_data` and does not require R2 or a paid storage subscription.

Cloudflare documents 1 GB of KV storage, 1,000 writes per day, and 100,000 reads per day on the free Workers plan. The current historical payload total is about 367 MB across 1,106 rows, with a largest row around 2.7 MB. The Worker groups up to two rows in one raw JSON KV value, so the expected archive needs about 553 KV writes and stays below the 1 GB storage limit. It rejects batches over KV's 25 MiB value limit; failed writes leave source rows intact.

## Rollout

1. Create the namespace with the EU jurisdiction and add its ID to `wrangler.jsonc` with binding `BACKUP_KV`. KV is included in the Workers Free plan; do not activate R2.
2. Set a random secret of at least 32 characters as Worker secret `BACKUP_ADMIN_SECRET`. Never put it in source control or the browser app.
3. Run `tools/supabase_kv_backup_migration.sql` in the Supabase SQL Editor. It adds a pointer and allows only the historical payload column to become null; existing row-level security remains enabled.
4. Deploy the Worker. Its existing 15-minute scheduled event archives up to two eligible historical rows per run. For an immediate backfill, POST to `/api/admin/backup-archive` with `Authorization: Bearer <secret>` and JSON `{"action":"archive","limit":2}` until the response says `scanned: 0`.
5. Test restoration with `{"action":"restore","limit":1}` before continuing. Restore copies the payload back to Supabase but keeps its KV pointer, so the scheduled archiver will not immediately archive it again.
6. Confirm that every source row has a KV pointer and no remaining payload before considering a table rewrite. Do not run `VACUUM FULL` until disk headroom and a maintenance window are confirmed; it needs extra temporary space and locks the table.

## Safety

- The Worker verifies the exact stored JSON before it clears a source row. Verification failure leaves the JSONB payload in Supabase.
- New archives keep large backup payloads as raw JSON and avoid parsing them in the Worker, staying within the free CPU limit; restore remains compatible with existing compressed KV objects.
- The archive endpoint requires a separate Worker secret and processes at most two rows per KV value per request.
- The scheduled archive uses the same verified write-and-conditional-update path, without exposing or requiring the admin HTTP secret. It only reads `fazatak_backups`; it never reads or changes active `fazatak_user_data` records.
- The 15-minute schedule can make at most 96 KV writes per day, below the free 1,000-write daily limit. A missing KV binding or failed verification never clears a source row; if a later row fails, already completed rows retain their verified pointers. Logs contain only error types or batch counts.
- The existing cron's notification work is isolated from archive failures.
- Restore intentionally retains the pointer to the verified KV copy. A restored row is therefore excluded from scheduled archival unless an operator deliberately changes its state.
- `VACUUM FULL` is never run automatically. It locks the table and should be used manually only after confirming all payloads have KV pointers and there is adequate disk headroom.
- Uncertain database responses leave the KV key in place; an orphan copy is safer than deleting a possible live copy.
- `fazatak_backups` is not used by the current app code. This archives its historical records; active account sync stays in Supabase.
- This archives the historical payload table, not a full Supabase project export. Supabase Free does not include scheduled project backups.
- KV is eventually consistent and has a 1 GB namespace limit. If the namespace fills or the free daily write cap is reached, stop; remaining Supabase source rows stay intact.

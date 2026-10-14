# Security migration runbook

The production project was emergency-locked before this code change. The secure migration below is local only and has not been applied to production.

## Before production rollout

1. In Supabase, enable Phone Auth and configure an SMS provider. Phone Auth was disabled at the time of the code review; do not expect sign-in to work until this is configured and tested.
2. Take a database backup. Confirm the legacy account and push tables exist.
3. If this is a new project, run `supabase_auth_schema.sql` and `supabase_push_schema.sql` first. On an existing project, do not rerun those setup scripts after the secure migration.
4. Run `supabase_secure_auth_migration.sql`. It adds owner IDs, removes all old policies, and creates account-owner policies. Existing `fazatak_user_data` and push rows are linked only after the matching phone is verified by SMS. Unowned legacy rows in `fazatak_backups` remain inaccessible; they are not guessed or assigned to an account.
5. Configure Cloudflare Worker variables and secrets as described in `web_push_setup.md`. Never put the service-role key in Vite or the repository.
6. Build and deploy the new app and Worker. Until these steps are complete, cloud login, sync, backup, and push are expected to remain unavailable.

## Emergency lock

`supabase_emergency_lockdown.sql` removes every policy and direct client grant from the four sensitive tables. It is safe to rerun during an incident, but it also disables the secure owner policies; rerunning it after rollout requires applying the secure migration again before cloud features can work.

## Required checks

- Anonymous requests cannot read or write any of the four sensitive tables.
- Authenticated users cannot directly select or modify `fazatak_users`.
- User A can read and update only rows where `owner_user_id = auth.uid()`; User B cannot read, update, restore, or delete A's rows.
- A phone number must be SMS-verified before its legacy account and `fazatak_user_data` row are linked.
- Push subscribe, test, and unsubscribe reject missing/invalid bearer tokens and never accept a caller-supplied phone as proof of ownership.
- Notifications contain no customer names or financial amounts.

## Deferred item

Legacy 9-digit renewal codes were derived from a static secret embedded in app builds. Client-side redemption is disabled on Web, Android, and iOS until a server-validated signed-code redemption path is implemented. Existing subscription status stored in Supabase and Google Play billing are unaffected.

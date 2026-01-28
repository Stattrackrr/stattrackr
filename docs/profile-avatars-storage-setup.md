# Profile Picture (Avatar) Storage Setup

The profile modal in the left sidebar lets users upload a profile picture. Avatars are stored in **Supabase Storage**.

## One-time setup

### 1. Create the bucket

1. In **Supabase Dashboard** go to **Storage**.
2. Click **New bucket**.
3. Name: `avatars`.
4. Enable **Public bucket** (so the app can show images via public URLs).
5. Create the bucket.

### 2. Add Storage policies

With **0 policies**, Storage denies uploads. You must add policies on `storage.objects` so authenticated users can upload to their own folder.

**Option A – Run the migration (recommended)**  
In the Supabase Dashboard: **SQL Editor** → New query → paste and run the contents of `migrations/storage_avatars_policies.sql`.

**Option B – Add policies in the Dashboard**  
In **Storage** → **avatars** → **Policies**, add:

- **INSERT**: Allow authenticated users, with check: `bucket_id = 'avatars'` and `(storage.foldername(name))[1] = (auth.uid())::text`.
- **UPDATE**: Same condition so users can overwrite their avatar (upsert).
- **SELECT**: Allow public (or authenticated) for `bucket_id = 'avatars'` so images can be read.
- **DELETE**: Allow authenticated users with the same folder check so users can remove their avatar.

The migration file defines these policies so each user can only upload/update/delete files under their own path `{user_id}/...`.

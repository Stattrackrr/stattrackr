-- Storage policies for the "avatars" bucket (profile pictures).
-- Run this after creating the public bucket "avatars" in Supabase Dashboard > Storage.
-- With 0 policies, Storage denies uploads; these policies allow authenticated users
-- to upload/update/delete only in their own folder (path: {user_id}/...).

-- Allow authenticated users to upload to avatars bucket only in their own folder
CREATE POLICY "Users can upload own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- Allow authenticated users to update (upsert) their own file in avatars
CREATE POLICY "Users can update own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

-- Allow anyone to read from avatars (public bucket)
CREATE POLICY "Public read avatars"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Allow authenticated users to delete their own file in avatars
CREATE POLICY "Users can delete own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

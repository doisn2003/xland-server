# User profile editing

`PATCH /api/v1/me/profile` requires an XLand bearer session. All fields are optional;
an empty object keeps the current profile. Omitted fields keep their values.

- `displayName`: up to 100 characters. An empty string clears the name.
- `contactPhone`: an international phone number or a Vietnamese 10-digit local number;
  `null` or an empty string clears it. Changing it resets contact verification.
- `address`: up to 500 characters; `null` or an empty string clears it. Stored in
  `xland.user_contacts` under the existing owner-only RLS policies.
- `avatar`: `{ "mimeType": "image/png", "bytesBase64": "..." }`. Supports JPEG,
  PNG and WebP up to 5 MiB. Bytes are checked on the server before publication.
- `avatarUrl: null` removes the current avatar. Do not combine `avatar` and `avatarUrl`.

The profile and session responses include nullable `address`. Existing clients
can ignore the additional response field.

Apply migration `0018_optional_user_profile.sql` with the existing migration runner
before starting the updated API. Configure backend `SUPABASE_URL` and either
`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Storage credentials never go
to the app. On the first avatar upload the API creates public bucket
`xland-user-avatars` if needed, restricted to the supported MIME types and 5 MiB.
Object keys are `<user-id>/<random-uuid>.<extension>`; uploads go through the API
using its service credentials. No anonymous/client upload policies are needed.

One save uploads the image and commits all profile fields in a database transaction.
If the database write fails, the API attempts to remove the new object. After a
successful replacement or removal it attempts to delete the previous owned avatar.
Cleanup is best effort so a Storage deletion outage does not undo a saved profile.
Legacy avatar URLs are never deleted. Text-only edits work without Storage configuration.

The Flutter editor supports selecting, previewing, replacing and removing an avatar,
and leaving or clearing any text field. The account header refreshes from the saved
profile immediately. iOS includes the photo library usage description; Android uses
the system photo picker and restores a pending selection after activity recreation.

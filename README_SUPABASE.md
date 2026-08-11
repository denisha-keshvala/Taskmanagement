# TASK COMMAND — Supabase Version

This package converts the supplied Google Apps Script + Index.html version to Supabase
without changing the existing dashboard/login design and layout.

## Files

- `index.html` — existing UI/design with the Google Apps Script bridge replaced by Supabase.
- `supabase-config.js` — browser Supabase configuration.
- `supabase_schema.sql` — tables, login RPC, task/announcement/profile RPCs, Storage buckets and policies.
- `README_SUPABASE.md` — this setup guide.

## Setup

1. Open your Supabase project SQL Editor.
2. Open `supabase_schema.sql`.
3. Run the whole SQL file once.
4. Put `index.html` and `supabase-config.js` in the same GitHub Pages folder.
5. Commit/push both files.
6. Open the GitHub Pages site with a hard refresh.

## First test login

The SQL includes two test accounts only if those employee IDs do not already exist:

- Owner ID: `owner`
- Owner password: `owner@123`
- Department: `Other`

and:

- Employee ID: `denisha`
- Employee password: `denisha@123`
- Department: `Other`

Change passwords/data after confirming the login works.

## Important

The old Google Sheet data is NOT automatically copied into Supabase by this package.
The original source used Google Apps Script/Google Sheets as its backend. The supplied
frontend calls the Apps Script bridge for login and data loading, so this version replaces
that bridge with Supabase RPC calls.

The browser stores only a temporary application session token in localStorage.
Passwords are stored as bcrypt hashes using pgcrypto and are never returned to the UI.

Profile-photo upload is Owner-only in this version, while the visual layout remains the same.

Storage uses Supabase buckets:
- `avatars`
- `task-attachments`

The bucket limits are intentionally modest so this works without requiring a paid Storage
upgrade. You can change the limits later if your project plan allows it.

## If login says "function ... does not exist"

Run the entire `supabase_schema.sql` again from top to bottom, then wait a few seconds and
refresh the site. The SQL ends with `notify pgrst, 'reload schema';`.

## If an old browser keeps the previous login

Use Logout, then hard refresh the page. The new version uses:
- `taskCommandUserId`
- `taskCommandSession`

The old Google Apps Script login bridge is no longer used.

# Question Media

This module stores only two media purposes:

- `QUESTION`
- `SOLUTION`

No option-image media type exists in this system.

## Storage

- Files are written to local development storage under `uploads/question-media/`
- Subfolders are split by purpose:
  - `uploads/question-media/question/`
  - `uploads/question-media/solution/`
- Stored `storage_url` values are relative paths such as:
  - `/uploads/question-media/question/<filename>`
  - `/uploads/question-media/solution/<filename>`

## Allowed file types

- `image/jpeg`
- `image/png`
- `image/webp`

## Notes

- The backend validates uploaded files by image signature, not just by file extension.
- This phase keeps media access behind authenticated teacher/admin routes.
- Solution media is preview-only for teacher/admin in this phase.
- No public static serving is enabled for solution images.
- Width and height are intentionally stored as `null` for now.


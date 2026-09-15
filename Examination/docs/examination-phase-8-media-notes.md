# Phase 8 Media Notes

## Created

- Teacher/admin question media upload
- Teacher/admin media list
- Teacher/admin media preview/access
- Teacher/admin replace
- Teacher/admin delete
- Local filesystem storage for development

## Not created

- Student media access
- Student solution unlock flow
- Option images
- Public unauthenticated static media URLs
- Result/grading features

## Safety

- Only `QUESTION` and `SOLUTION` media purposes are supported
- No `OPTION` media type exists
- Image validation is restricted to JPEG, PNG, and WEBP
- Large files are capped at 5 MB
- All DB-backed routes still check schema readiness


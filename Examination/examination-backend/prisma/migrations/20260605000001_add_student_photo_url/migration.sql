-- Add photo_url to student_profiles
-- Stores the web-relative path to the student's photo from RMC (e.g. /uploads/photo.jpg)
ALTER TABLE "student_profiles" ADD COLUMN "photo_url" TEXT;

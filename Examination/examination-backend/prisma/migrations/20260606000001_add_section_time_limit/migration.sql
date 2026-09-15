-- Add per-section time limit to exam delivery rules.
-- NULL = no section timer (students can use the full exam duration freely across sections).
ALTER TABLE "exam_section_delivery_rules" ADD COLUMN "section_time_limit_seconds" INTEGER;

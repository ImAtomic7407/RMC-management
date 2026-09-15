-- Add user_id to identity_bridge so we can resolve a user even when their
-- student_uid changes in RMC (source_uid is the stable RMC identity key).
-- SQLite does not support adding FK constraints via ALTER TABLE, so the FK
-- is declared in schema.prisma and enforced at the application level.

ALTER TABLE "identity_bridge" ADD COLUMN "user_id" INTEGER;

CREATE INDEX "identity_bridge_user_id_idx" ON "identity_bridge"("user_id");

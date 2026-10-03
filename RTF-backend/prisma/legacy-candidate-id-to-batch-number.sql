DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'candidateId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'batchNumber'
  ) THEN
    DROP INDEX IF EXISTS "User_candidateId_key";
    ALTER TABLE "User" RENAME COLUMN "candidateId" TO "batchNumber";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'batchNumber'
  ) THEN
    CREATE INDEX IF NOT EXISTS "User_batchNumber_idx" ON "User" ("batchNumber");
  END IF;
END
$$;

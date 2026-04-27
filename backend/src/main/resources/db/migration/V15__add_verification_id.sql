DO $$
BEGIN
  -- add id column if missing and populate for existing rows
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='verification_codes' AND column_name='id'
  ) THEN
    CREATE SEQUENCE IF NOT EXISTS verification_codes_id_seq;
    ALTER TABLE verification_codes ADD COLUMN id bigint;
    UPDATE verification_codes SET id = nextval('verification_codes_id_seq') WHERE id IS NULL;
    ALTER SEQUENCE verification_codes_id_seq OWNED BY verification_codes.id;
    ALTER TABLE verification_codes ALTER COLUMN id SET NOT NULL;
    ALTER TABLE verification_codes ALTER COLUMN id SET DEFAULT nextval('verification_codes_id_seq');
  END IF;

  -- add primary key constraint if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='pk_verification_codes_id'
  ) THEN
    ALTER TABLE verification_codes ADD CONSTRAINT pk_verification_codes_id PRIMARY KEY (id);
  END IF;
END $$;

-- Add phone to users and verification codes table
alter table users add column if not exists phone varchar(32);
create unique index if not exists idx_users_phone on users(phone);

create table if not exists verification_codes (
  phone varchar(32) not null,
  code varchar(16) not null,
  expires_at timestamp,
  attempts int default 0,
  via varchar(32),
  created_at timestamp default now()
);
create index if not exists idx_verification_phone on verification_codes(phone);

-- Add name field for group chats (nullable — DIRECT chats don't need it)
alter table chats add column if not exists name varchar(100);

alter table users add column if not exists first_name varchar(255);
alter table users add column if not exists last_name varchar(255);

alter table users add column if not exists avatar_url text;
alter table users alter column avatar_url type text;
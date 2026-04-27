create table if not exists users (
                                     id bigserial primary key,
                                     username varchar(100) not null unique,
    email varchar(255) not null unique,
    password_hash varchar(255) not null,
    public_key text,
    status varchar(50) not null,
    created_at timestamp not null default current_timestamp
    );
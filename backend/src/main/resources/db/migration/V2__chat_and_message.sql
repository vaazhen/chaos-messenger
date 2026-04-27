create table chats (
                       id bigserial primary key,
                       type varchar(20) not null,
                       created_at timestamp not null
);

create table chat_participants (
                                   id bigserial primary key,
                                   chat_id bigint not null,
                                   user_id bigint not null
);

create table messages (
                          id bigserial primary key,
                          chat_id bigint not null,
                          sender_id bigint not null,
                          content text not null,
                          created_at timestamp not null
);
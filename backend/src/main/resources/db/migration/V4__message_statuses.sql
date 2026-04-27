create table message_statuses (
                                  id bigserial primary key,
                                  message_id bigint not null,
                                  user_id bigint not null,
                                  status varchar(20) not null,
                                  updated_at timestamp not null
);

alter table message_statuses
    add constraint uk_message_statuses_message_user unique (message_id, user_id);
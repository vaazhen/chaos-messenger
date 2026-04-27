CREATE TABLE user_devices (
                              id BIGSERIAL PRIMARY KEY,
                              user_id BIGINT NOT NULL REFERENCES users(id),
                              device_id VARCHAR(100) NOT NULL,
                              registration_id INTEGER NOT NULL,
                              device_name VARCHAR(255),
                              identity_public_key TEXT NOT NULL,
                              is_active BOOLEAN NOT NULL DEFAULT TRUE,
                              last_seen TIMESTAMP,
                              created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                              UNIQUE (user_id, device_id)
);

CREATE TABLE signed_prekeys (
                                id BIGSERIAL PRIMARY KEY,
                                device_db_id BIGINT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
                                prekey_id INTEGER NOT NULL,
                                public_key TEXT NOT NULL,
                                signature TEXT NOT NULL,
                                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                                expires_at TIMESTAMP,
                                UNIQUE (device_db_id, prekey_id)
);

CREATE TABLE one_time_prekeys (
                                  id BIGSERIAL PRIMARY KEY,
                                  device_db_id BIGINT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
                                  prekey_id INTEGER NOT NULL,
                                  public_key TEXT NOT NULL,
                                  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                                  used_at TIMESTAMP NULL,
                                  UNIQUE (device_db_id, prekey_id)
);

CREATE TABLE device_sessions (
                                 id BIGSERIAL PRIMARY KEY,
                                 local_device_db_id BIGINT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
                                 remote_device_db_id BIGINT NOT NULL REFERENCES user_devices(id) ON DELETE CASCADE,
                                 session_state TEXT NOT NULL,
                                 session_version INTEGER NOT NULL DEFAULT 1,
                                 created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                                 updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
                                 UNIQUE (local_device_db_id, remote_device_db_id)
);

CREATE INDEX idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX idx_signed_prekeys_device_db_id ON signed_prekeys(device_db_id);
CREATE INDEX idx_one_time_prekeys_device_db_id ON one_time_prekeys(device_db_id);
CREATE INDEX idx_one_time_prekeys_used_at ON one_time_prekeys(used_at);
CREATE INDEX idx_device_sessions_local_remote
    ON device_sessions(local_device_db_id, remote_device_db_id);
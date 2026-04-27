package ru.messenger.chaosmessenger.infra.presence;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class UserStatusEvent {
    private String username;
    private String status; // ONLINE, OFFLINE, TYPING
    private long timestamp;
}
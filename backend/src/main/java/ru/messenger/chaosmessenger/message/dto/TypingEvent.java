package ru.messenger.chaosmessenger.message.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class TypingEvent {
    private String username;
    private boolean typing;
}
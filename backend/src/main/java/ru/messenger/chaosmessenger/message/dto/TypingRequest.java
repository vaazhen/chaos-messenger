package ru.messenger.chaosmessenger.message.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class TypingRequest {
    @NotNull(message = "Chat ID is required")
    private Long chatId;

    private boolean typing;
}

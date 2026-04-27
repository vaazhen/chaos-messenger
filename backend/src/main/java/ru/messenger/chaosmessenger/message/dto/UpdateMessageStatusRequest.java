package ru.messenger.chaosmessenger.message.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

@Data
public class UpdateMessageStatusRequest {
    @NotNull(message = "Message ID is required")
    private Long messageId;

    @NotBlank(message = "Status is required")
    @Pattern(regexp = "DELIVERED|READ", message = "Status must be DELIVERED or READ")
    private String status;
}

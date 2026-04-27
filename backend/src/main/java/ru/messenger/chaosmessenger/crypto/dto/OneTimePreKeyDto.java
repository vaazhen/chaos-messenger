package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

@Data
public class OneTimePreKeyDto {
    @NotNull(message = "One-time pre-key ID is required")
    @Positive(message = "One-time pre-key ID must be positive")
    private Integer preKeyId;

    @NotBlank(message = "One-time pre-key public key is required")
    private String publicKey;
}

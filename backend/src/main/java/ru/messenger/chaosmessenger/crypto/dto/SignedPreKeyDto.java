package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

@Data
public class SignedPreKeyDto {
    @NotNull(message = "Signed pre-key ID is required")
    @Positive(message = "Signed pre-key ID must be positive")
    private Integer preKeyId;

    @NotBlank(message = "Signed pre-key public key is required")
    private String publicKey;

    @NotBlank(message = "Signed pre-key signature is required")
    private String signature;
}

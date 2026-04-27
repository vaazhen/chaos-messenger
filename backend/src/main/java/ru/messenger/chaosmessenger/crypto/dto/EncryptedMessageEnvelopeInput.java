package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class EncryptedMessageEnvelopeInput {
    @NotBlank(message = "Target device ID is required")
    private String targetDeviceId;

    @NotNull(message = "Target user ID is required")
    private Long targetUserId;

    @NotBlank(message = "Message type is required")
    private String messageType;

    @NotBlank(message = "Sender identity public key is required")
    private String senderIdentityPublicKey;

    private String ephemeralPublicKey;

    @NotBlank(message = "Ciphertext is required")
    private String ciphertext;

    @NotBlank(message = "Nonce is required")
    private String nonce;

    private Integer signedPreKeyId;
    private Integer oneTimePreKeyId;
    private Long timestamp;
    private Integer messageIndex;
}

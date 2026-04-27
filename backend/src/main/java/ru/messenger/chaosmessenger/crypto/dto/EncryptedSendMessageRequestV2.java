package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class EncryptedSendMessageRequestV2 {
    @NotNull(message = "Chat ID is required")
    private Long chatId;

    @NotBlank(message = "Client message ID is required")
    private String clientMessageId;

    @NotBlank(message = "Sender device ID is required")
    private String senderDeviceId;

    @Valid
    @NotEmpty(message = "At least one encrypted envelope is required")
    private List<EncryptedMessageEnvelopeInput> envelopes;
}

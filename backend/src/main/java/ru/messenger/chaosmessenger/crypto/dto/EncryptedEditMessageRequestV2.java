package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;

import java.util.List;

@Data
public class EncryptedEditMessageRequestV2 {
    @NotBlank(message = "Sender device ID is required")
    private String senderDeviceId;

    @Valid
    @NotEmpty(message = "At least one encrypted envelope is required")
    private List<EncryptedMessageEnvelopeInput> envelopes;
}

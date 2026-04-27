package ru.messenger.chaosmessenger.crypto.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.Data;

import java.util.List;

@Data
public class DeviceRegistrationRequest {
    @NotBlank(message = "Device ID is required")
    private String deviceId;

    @NotBlank(message = "Device name is required")
    private String deviceName;

    @NotNull(message = "Registration ID is required")
    @Positive(message = "Registration ID must be positive")
    private Integer registrationId;

    @NotBlank(message = "Identity public key is required")
    private String identityPublicKey;

    @NotBlank(message = "Signing public key is required")
    private String signingPublicKey;

    @Valid
    @NotNull(message = "Signed pre-key is required")
    private SignedPreKeyDto signedPreKey;

    @Valid
    private List<OneTimePreKeyDto> oneTimePreKeys;
}

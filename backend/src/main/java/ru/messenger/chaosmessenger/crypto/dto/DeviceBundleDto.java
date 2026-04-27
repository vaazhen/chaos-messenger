package ru.messenger.chaosmessenger.crypto.dto;

import lombok.Builder;
import lombok.Value;

@Value
@Builder
public class DeviceBundleDto {
    Long userId;
    Long deviceDbId;
    String deviceId;
    Integer registrationId;
    String deviceName;
    String identityPublicKey;
    SignedPreKeyDto signedPreKey;
    OneTimePreKeyDto oneTimePreKey;
}

package ru.messenger.chaosmessenger.crypto.dto;

import lombok.Builder;
import lombok.Value;

@Value
@Builder
public class DeviceRegistrationResponse {
    String deviceId;
    Long serverDeviceInternalId;
}
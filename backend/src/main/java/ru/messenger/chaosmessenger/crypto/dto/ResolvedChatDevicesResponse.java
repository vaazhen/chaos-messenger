package ru.messenger.chaosmessenger.crypto.dto;

import lombok.Builder;
import lombok.Value;

import java.util.List;

@Value
@Builder
public class ResolvedChatDevicesResponse {
    Long chatId;
    String username;
    String currentDeviceId;
    List<DeviceBundleDto> targetDevices;
}

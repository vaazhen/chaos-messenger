package ru.messenger.chaosmessenger.crypto.dto;

import lombok.Builder;
import lombok.Value;

import java.util.List;

@Value
@Builder
public class PreKeyBundleResponse {
    String username;
    List<DeviceBundleDto> devices;
}
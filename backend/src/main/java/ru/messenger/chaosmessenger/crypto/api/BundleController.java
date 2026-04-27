package ru.messenger.chaosmessenger.crypto.api;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.dto.PreKeyBundleResponse;
import ru.messenger.chaosmessenger.crypto.dto.ResolvedChatDevicesResponse;
import ru.messenger.chaosmessenger.crypto.prekey.PreKeyService;

@RestController
@RequestMapping("/api/crypto")
@RequiredArgsConstructor
public class BundleController {

    private final PreKeyService preKeyService;
    private final CurrentDeviceService currentDeviceService;

    @GetMapping("/bundle/{username}")
    public PreKeyBundleResponse getBundle(@PathVariable String username, Authentication authentication) {
        currentDeviceService.requireCurrentDevice();
        return preKeyService.getBundleByUsername(username);
    }

    @PostMapping("/resolve-chat-devices/{chatId}")
    public ResolvedChatDevicesResponse resolveChatDevices(@PathVariable Long chatId, Authentication authentication) {
        currentDeviceService.requireCurrentDevice();
        return preKeyService.resolveChatDevices(authentication.getName(), chatId);
    }
}
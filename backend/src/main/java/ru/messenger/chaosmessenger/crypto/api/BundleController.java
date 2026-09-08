package ru.messenger.chaosmessenger.crypto.api;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.dto.DeviceBundleDto;
import ru.messenger.chaosmessenger.crypto.dto.PreKeyBundleResponse;
import ru.messenger.chaosmessenger.crypto.dto.ResolvedChatDevicesResponse;
import ru.messenger.chaosmessenger.auth.service.CredentialRateLimiter;
import ru.messenger.chaosmessenger.crypto.prekey.PreKeyService;

@RestController
@RequestMapping("/api/crypto")
@RequiredArgsConstructor
public class BundleController {

    private final PreKeyService preKeyService;
    private final CurrentDeviceService currentDeviceService;
    private final CredentialRateLimiter credentialRateLimiter;

    @GetMapping("/bundle/{username}")
    public PreKeyBundleResponse getBundle(@PathVariable String username, Authentication authentication) {
        currentDeviceService.requireCurrentDevice();
        return preKeyService.getBundleByUsername(authentication.getName(), username);
    }

    @PostMapping("/resolve-chat-devices/{chatId}")
    public ResolvedChatDevicesResponse resolveChatDevices(@PathVariable Long chatId, Authentication authentication) {
        currentDeviceService.requireCurrentDevice();
        return preKeyService.resolveChatDevices(authentication.getName(), chatId);
    }

    @PostMapping("/chats/{chatId}/devices/{targetDeviceId}/reserve-prekey")
    public DeviceBundleDto reserveOneTimePreKey(
            @PathVariable Long chatId,
            @PathVariable String targetDeviceId,
            Authentication authentication
    ) {
        currentDeviceService.requireCurrentDevice();
        credentialRateLimiter.checkPrekeyReserve(authentication.getName(), targetDeviceId);
        return preKeyService.reserveChatDeviceOneTimePreKey(authentication.getName(), chatId, targetDeviceId);
    }
}
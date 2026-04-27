package ru.messenger.chaosmessenger.crypto.prekey;


import ru.messenger.chaosmessenger.user.service.UserIdentityService;
import ru.messenger.chaosmessenger.common.exception.*;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.*;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class PreKeyService {

    private final UserRepository userRepository;
    private final UserIdentityService userIdentityService;
    private final UserDeviceRepository userDeviceRepository;
    private final SignedPreKeyRepository signedPreKeyRepository;
    private final OneTimePreKeyRepository oneTimePreKeyRepository;
    private final ChatParticipantRepository chatParticipantRepository;
    private final CurrentDeviceService currentDeviceService;

    @Transactional(readOnly = true)
    public PreKeyBundleResponse getBundleByUsername(String username) {
        List<UserDevice> devices = userDeviceRepository.findByUserUsernameAndActiveTrue(username);
        return PreKeyBundleResponse.builder()
                .username(username)
                .devices(devices.stream().map(this::toDeviceBundleReadOnly).toList())
                .build();
    }

    @Transactional
    public ResolvedChatDevicesResponse resolveChatDevices(String username, Long chatId) {
        User currentUser = userIdentityService.require(username);

        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();

        if (!chatParticipantRepository.existsByChatIdAndUserId(chatId, currentUser.getId())) {
            throw new ChatException("You are not a participant of this chat");
        }

        List<Long> participantUserIds = chatParticipantRepository.findByChatId(chatId).stream()
                .map(p -> p.getUserId())
                .distinct()
                .toList();

        List<DeviceBundleDto> targets = new ArrayList<>();
        Set<String> seenDeviceIds = new HashSet<>();
        for (Long participantUserId : participantUserIds) {
            List<UserDevice> participantDevices = userDeviceRepository.findByUserIdAndActiveTrue(participantUserId);
            for (UserDevice device : participantDevices) {
                if (!seenDeviceIds.add(device.getDeviceId())) {
                    // Device IDs must be globally unique across all participants for WebSocket topic routing.
                    // Skip duplicates to avoid broadcasting the same envelope twice.
                    continue;
                }
                if (Objects.equals(device.getId(), currentDevice.getId())) {
                    // Include the sender's own device so that sent messages remain
                    // decryptable in the timeline after a page reload.
                    targets.add(toDeviceBundleReadOnly(device));
                    continue;
                }
                targets.add(toDeviceBundleWithReservedPreKey(device));
            }
        }

        return ResolvedChatDevicesResponse.builder()
                .chatId(chatId)
                .username(username)
                .currentDeviceId(currentDevice.getDeviceId())
                .targetDevices(targets)
                .build();
    }

    private DeviceBundleDto toDeviceBundleReadOnly(UserDevice device) {
        SignedPreKey signedPreKey =
                signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(device.getId()).orElse(null);

        OneTimePreKey oneTimePreKey =
                oneTimePreKeyRepository.findAvailableReadOnly(device.getId()).stream().findFirst().orElse(null);

        return buildDto(device, signedPreKey, oneTimePreKey);
    }

    private DeviceBundleDto toDeviceBundleWithReservedPreKey(UserDevice device) {
        SignedPreKey signedPreKey =
                signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(device.getId()).orElse(null);

        OneTimePreKey oneTimePreKey =
                oneTimePreKeyRepository.findAvailableForUpdate(device.getId()).stream().findFirst().orElse(null);

        if (oneTimePreKey != null && oneTimePreKey.getUsedAt() == null) {
            oneTimePreKey.setUsedAt(LocalDateTime.now());
            oneTimePreKeyRepository.save(oneTimePreKey);
        }

        return buildDto(device, signedPreKey, oneTimePreKey);
    }

    private DeviceBundleDto buildDto(UserDevice device, SignedPreKey signedPreKey, OneTimePreKey oneTimePreKey) {
        SignedPreKeyDto signedDto = null;
        if (signedPreKey != null) {
            signedDto = new SignedPreKeyDto();
            signedDto.setPreKeyId(signedPreKey.getPreKeyId());
            signedDto.setPublicKey(signedPreKey.getPublicKey());
            signedDto.setSignature(signedPreKey.getSignature());
        }

        OneTimePreKeyDto oneTimeDto = null;
        if (oneTimePreKey != null) {
            oneTimeDto = new OneTimePreKeyDto();
            oneTimeDto.setPreKeyId(oneTimePreKey.getPreKeyId());
            oneTimeDto.setPublicKey(oneTimePreKey.getPublicKey());
        }

        return DeviceBundleDto.builder()
                .userId(device.getUser().getId())
                .deviceDbId(device.getId())
                .deviceId(device.getDeviceId())
                .deviceName(device.getDeviceName())
                .registrationId(device.getRegistrationId())
                .identityPublicKey(device.getIdentityPublicKey())
                .signedPreKey(signedDto)
                .oneTimePreKey(oneTimeDto)
                .build();
    }
}
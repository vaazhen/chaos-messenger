package ru.messenger.chaosmessenger.crypto.prekey;

import ru.messenger.chaosmessenger.user.service.UserIdentityService;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.common.exception.CryptoException;

import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.DeviceBundleDto;
import ru.messenger.chaosmessenger.crypto.dto.OneTimePreKeyDto;
import ru.messenger.chaosmessenger.crypto.dto.PreKeyBundleResponse;
import ru.messenger.chaosmessenger.crypto.dto.ResolvedChatDevicesResponse;
import ru.messenger.chaosmessenger.crypto.dto.SignedPreKeyDto;
import ru.messenger.chaosmessenger.user.domain.User;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PreKeyService {

    private final UserIdentityService userIdentityService;
    private final UserDeviceRepository userDeviceRepository;
    private final SignedPreKeyRepository signedPreKeyRepository;
    private final OneTimePreKeyRepository oneTimePreKeyRepository;
    private final ChatParticipantRepository chatParticipantRepository;
    private final CurrentDeviceService currentDeviceService;

    @Transactional(readOnly = true)
    public PreKeyBundleResponse getBundleByUsername(String requesterUsername, String targetUsername) {
        User requester = userIdentityService.require(requesterUsername);
        String lookupUsername = authorizeBundleLookup(requester, targetUsername);
        List<UserDevice> devices = userDeviceRepository.findActiveByUsernameWithUser(lookupUsername);
        Map<Long, SignedPreKey> signedByDeviceId = latestSignedPreKeys(devices);
        return new PreKeyBundleResponse(
                lookupUsername,
                devices.stream()
                        .map(device -> toDeviceBundleWithoutOneTimePreKey(device, signedByDeviceId.get(device.getId())))
                        .toList()
        );
    }

    private String authorizeBundleLookup(User requester, String targetUsername) {
        if (targetUsername != null && requester.getUsername().equalsIgnoreCase(targetUsername.trim())) {
            return requester.getUsername();
        }

        User target = userIdentityService.resolve(targetUsername).orElse(null);
        if (target == null || !chatParticipantRepository.shareAnyChat(requester.getId(), target.getId())) {
            throw new AccessDeniedException("Bundle lookup is not allowed");
        }
        return target.getUsername();
    }

    @Transactional(readOnly = true)
    public ResolvedChatDevicesResponse resolveChatDevices(String username, Long chatId) {
        User currentUser = userIdentityService.require(username);

        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();

        if (!chatParticipantRepository.existsByChatIdAndUserId(chatId, currentUser.getId())) {
            throw new ChatException("You are not a participant of this chat");
        }

        List<Long> participantUserIds = chatParticipantRepository.findUserIdsByChatId(chatId).stream()
                .distinct()
                .toList();

        List<DeviceBundleDto> targets = new ArrayList<>();
        Set<String> seenDeviceIds = new HashSet<>();
        List<UserDevice> participantDevices = participantUserIds.isEmpty()
                ? List.of()
                : userDeviceRepository.findActiveByUserIdsWithUser(participantUserIds);

        Map<Long, SignedPreKey> signedByDeviceId = latestSignedPreKeys(participantDevices);

        for (UserDevice device : participantDevices) {
            if (!seenDeviceIds.add(device.getDeviceId())) {
                // Device IDs must be globally unique across all participants for WebSocket topic routing.
                // Skip duplicates to avoid broadcasting the same envelope twice.
                continue;
            }
            targets.add(toDeviceBundleWithoutOneTimePreKey(device, signedByDeviceId.get(device.getId())));
        }

        return new ResolvedChatDevicesResponse(chatId, username, currentDevice.getDeviceId(), targets);
    }

    /**
     * Reserve a one-time prekey for a specific target device in a chat.
     * <p>
     * This endpoint must be used only when the client has no session with the target device.
     * It performs membership checks to prevent burning prekeys for arbitrary devices.
     */
    @Transactional
    public DeviceBundleDto reserveChatDeviceOneTimePreKey(String username, Long chatId, String targetDeviceId) {
        if (targetDeviceId == null || targetDeviceId.isBlank()) {
            throw new CryptoException("targetDeviceId is required");
        }

        User currentUser = userIdentityService.require(username);
        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();

        if (!chatParticipantRepository.existsByChatIdAndUserId(chatId, currentUser.getId())) {
            throw new ChatException("Chat not found");
        }

        UserDevice targetDevice = userDeviceRepository.findByDeviceIdAndActiveTrueWithUser(targetDeviceId)
                .orElseThrow(() -> new CryptoException("Target device not found"));

        if (Objects.equals(targetDevice.getDeviceId(), currentDevice.getDeviceId())) {
            throw new CryptoException("Cannot reserve prekey for the current device");
        }

        // Ensure the target device belongs to a participant of this chat.
        if (!chatParticipantRepository.existsByChatIdAndUserId(chatId, targetDevice.getUser().getId())) {
            throw new ChatException("Chat not found");
        }

        SignedPreKey signedPreKey = latestSignedPreKeys(List.of(targetDevice)).get(targetDevice.getId());

        OneTimePreKey oneTimePreKey = oneTimePreKeyRepository.findOneAvailableForUpdate(targetDevice.getId())
                .orElse(null);
        if (oneTimePreKey == null || oneTimePreKey.getUsedAt() != null) {
            throw new CryptoException("One-time pre-key pool is empty");
        }
        oneTimePreKey.setUsedAt(LocalDateTime.now());
        oneTimePreKeyRepository.save(oneTimePreKey);

        return buildDto(targetDevice, signedPreKey, oneTimePreKey);
    }

    private ReadOnlyPreKeys loadReadOnlyPreKeys(Collection<UserDevice> devices) {
        if (devices == null || devices.isEmpty()) {
            return new ReadOnlyPreKeys(Map.of(), Map.of());
        }

        List<Long> deviceDbIds = devices.stream()
                .map(UserDevice::getId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();

        if (deviceDbIds.isEmpty()) {
            return new ReadOnlyPreKeys(Map.of(), Map.of());
        }

        Map<Long, SignedPreKey> signedByDeviceId = signedPreKeyRepository.findLatestByDeviceIds(deviceDbIds)
                .stream()
                .collect(Collectors.toMap(
                        key -> key.getDevice().getId(),
                        Function.identity(),
                        (left, right) -> left
                ));

        Map<Long, OneTimePreKey> oneTimeByDeviceId = oneTimePreKeyRepository.findFirstAvailableReadOnlyByDeviceIds(deviceDbIds)
                .stream()
                .collect(Collectors.toMap(
                        key -> key.getDevice().getId(),
                        Function.identity(),
                        (left, right) -> left
                ));

        return new ReadOnlyPreKeys(signedByDeviceId, oneTimeByDeviceId);
    }

    private Map<Long, SignedPreKey> latestSignedPreKeys(Collection<UserDevice> devices) {
        if (devices == null || devices.isEmpty()) {
            return Map.of();
        }

        List<Long> deviceDbIds = devices.stream()
                .map(UserDevice::getId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();

        if (deviceDbIds.isEmpty()) {
            return Map.of();
        }

        return signedPreKeyRepository.findLatestByDeviceIds(deviceDbIds)
                .stream()
                .collect(Collectors.toMap(
                        key -> key.getDevice().getId(),
                        Function.identity(),
                        (left, right) -> left
                ));
    }

    private DeviceBundleDto toDeviceBundleReadOnly(UserDevice device, ReadOnlyPreKeys preKeys) {
        return buildDto(
                device,
                preKeys.signedByDeviceId().get(device.getId()),
                preKeys.oneTimeByDeviceId().get(device.getId())
        );
    }

    /**
     * IMPORTANT: read-only resolve MUST NOT return one-time prekeys.
     * Otherwise clients could reuse a "one-time" prekey multiple times.
     * One-time prekeys should only be issued via an explicit reserve endpoint.
     */
    private DeviceBundleDto toDeviceBundleWithoutOneTimePreKey(UserDevice device, SignedPreKey signedPreKey) {
        return buildDto(device, signedPreKey, null);
    }

    private DeviceBundleDto toDeviceBundleWithReservedPreKey(UserDevice device, SignedPreKey signedPreKey) {
        OneTimePreKey oneTimePreKey = oneTimePreKeyRepository.findOneAvailableForUpdate(device.getId()).orElse(null);
        if (oneTimePreKey == null || oneTimePreKey.getUsedAt() != null) {
            throw new CryptoException("One-time pre-key pool is empty");
        }
        oneTimePreKey.setUsedAt(LocalDateTime.now());
        oneTimePreKeyRepository.save(oneTimePreKey);
        return buildDto(device, signedPreKey, oneTimePreKey);
    }

    private DeviceBundleDto buildDto(UserDevice device, SignedPreKey signedPreKey, OneTimePreKey oneTimePreKey) {
        SignedPreKeyDto signedDto = null;
        if (signedPreKey != null) {
            signedDto = new SignedPreKeyDto(
                    signedPreKey.getPreKeyId(),
                    signedPreKey.getPublicKey(),
                    signedPreKey.getSignature()
            );
        }

        OneTimePreKeyDto oneTimeDto = null;
        if (oneTimePreKey != null) {
            oneTimeDto = new OneTimePreKeyDto(oneTimePreKey.getPreKeyId(), oneTimePreKey.getPublicKey());
        }

        return new DeviceBundleDto(
                device.getUser().getId(),
                device.getId(),
                device.getDeviceId(),
                device.getRegistrationId(),
                device.getDeviceName(),
                device.getIdentityPublicKey(),
                device.getSigningPublicKey(),
                signedDto,
                oneTimeDto
        );
    }

    private record ReadOnlyPreKeys(
            Map<Long, SignedPreKey> signedByDeviceId,
            Map<Long, OneTimePreKey> oneTimeByDeviceId
    ) {
    }
}

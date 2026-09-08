package ru.messenger.chaosmessenger.crypto;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.DeviceBundleDto;
import ru.messenger.chaosmessenger.crypto.dto.PreKeyBundleResponse;
import ru.messenger.chaosmessenger.crypto.dto.ResolvedChatDevicesResponse;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKey;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKeyRepository;
import ru.messenger.chaosmessenger.crypto.prekey.PreKeyService;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKey;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKeyRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PreKeyServiceTest {

    @Mock UserRepository userRepository;
    @Mock UserIdentityService userIdentityService;
    @Mock UserDeviceRepository userDeviceRepository;
    @Mock SignedPreKeyRepository signedPreKeyRepository;
    @Mock OneTimePreKeyRepository oneTimePreKeyRepository;
    @Mock ChatParticipantRepository chatParticipantRepository;
    @Mock CurrentDeviceService currentDeviceService;

    @InjectMocks PreKeyService preKeyService;

    private User alice;
    private User bob;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        bob = TestFixtures.user(2L, "bob");
    }

    @Test
    void getBundleByUsernameReturnsSignedPreKeyWithoutOneTimePreKey() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        SignedPreKey signed = signedPreKey(aliceDevice, 7, "signed-public", "signature");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userDeviceRepository.findActiveByUsernameWithUser("alice"))
                .thenReturn(List.of(aliceDevice));
        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(10L)))
                .thenReturn(List.of(signed));

        PreKeyBundleResponse response = preKeyService.getBundleByUsername("alice", "alice");

        assertThat(response.username()).isEqualTo("alice");
        assertThat(response.devices()).hasSize(1);

        DeviceBundleDto dto = response.devices().get(0);
        assertThat(dto.userId()).isEqualTo(alice.getId());
        assertThat(dto.deviceDbId()).isEqualTo(10L);
        assertThat(dto.deviceId()).isEqualTo("alice-phone");
        assertThat(dto.registrationId()).isEqualTo(123);
        assertThat(dto.identityPublicKey()).isEqualTo("identity-alice-phone");
        assertThat(dto.signingPublicKey()).isEqualTo("signing-alice-phone");

        assertThat(dto.signedPreKey().preKeyId()).isEqualTo(7);
        assertThat(dto.signedPreKey().publicKey()).isEqualTo("signed-public");
        assertThat(dto.signedPreKey().signature()).isEqualTo("signature");

        assertThat(dto.oneTimePreKey()).isNull();

        verify(oneTimePreKeyRepository, never()).findAvailableForUpdate(10L);
        verify(oneTimePreKeyRepository, never()).findFirstAvailableReadOnlyByDeviceIds(List.of(10L));
    }

    @Test
    void getBundleByUsernameAllowsSharedChatParticipant() {
        UserDevice bobDevice = device(20L, bob, "bob-phone");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userIdentityService.resolve("bob")).thenReturn(java.util.Optional.of(bob));
        when(chatParticipantRepository.shareAnyChat(alice.getId(), bob.getId())).thenReturn(true);
        when(userDeviceRepository.findActiveByUsernameWithUser("bob"))
                .thenReturn(List.of(bobDevice));
        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(20L)))
                .thenReturn(List.of());

        PreKeyBundleResponse response = preKeyService.getBundleByUsername("alice", "bob");

        assertThat(response.username()).isEqualTo("bob");
        assertThat(response.devices()).extracting(DeviceBundleDto::deviceId)
                .containsExactly("bob-phone");
    }

    @Test
    void getBundleByUsernameRejectsUnrelatedUser() {
        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userIdentityService.resolve("bob")).thenReturn(java.util.Optional.of(bob));
        when(chatParticipantRepository.shareAnyChat(alice.getId(), bob.getId())).thenReturn(false);

        assertThatThrownBy(() -> preKeyService.getBundleByUsername("alice", "bob"))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class)
                .hasMessageContaining("Bundle lookup is not allowed");

        verify(userDeviceRepository, never()).findActiveByUsernameWithUser("bob");
    }

    @Test
    void getBundleByUsernameDoesNotRevealUnknownUsers() {
        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userIdentityService.resolve("ghost")).thenReturn(java.util.Optional.empty());

        assertThatThrownBy(() -> preKeyService.getBundleByUsername("alice", "ghost"))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class)
                .hasMessageContaining("Bundle lookup is not allowed");

        verify(userDeviceRepository, never()).findActiveByUsernameWithUser("ghost");
    }

    @Test
    void getBundleByUsernameAllowsDevicesWithoutAvailablePreKeys() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(userDeviceRepository.findActiveByUsernameWithUser("alice"))
                .thenReturn(List.of(aliceDevice));
        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(10L)))
                .thenReturn(List.of());

        PreKeyBundleResponse response = preKeyService.getBundleByUsername("alice", "alice");

        DeviceBundleDto dto = response.devices().get(0);
        assertThat(dto.signedPreKey()).isNull();
        assertThat(dto.oneTimePreKey()).isNull();
    }

    @Test
    void resolveChatDevicesRejectsNonParticipant() {
        UserDevice currentDevice = device(10L, alice, "alice-phone");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(currentDevice);
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, alice.getId()))
                .thenReturn(false);

        assertThatThrownBy(() -> preKeyService.resolveChatDevices("alice", 100L))
                .isInstanceOf(ChatException.class)
                .hasMessageContaining("You are not a participant of this chat");

        verify(chatParticipantRepository, never()).findUserIdsByChatId(100L);
    }

    @Test
    void resolveChatDevicesReturnsSignedPreKeysAndDoesNotReturnOneTimePreKeys() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        UserDevice bobDevice = device(20L, bob, "bob-laptop");

        SignedPreKey aliceSigned = signedPreKey(aliceDevice, 7, "alice-signed", "alice-signature");
        SignedPreKey bobSigned = signedPreKey(bobDevice, 8, "bob-signed", "bob-signature");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, alice.getId()))
                .thenReturn(true);
        when(chatParticipantRepository.findUserIdsByChatId(100L))
                .thenReturn(List.of(alice.getId(), bob.getId()));

        when(userDeviceRepository.findActiveByUserIdsWithUser(List.of(alice.getId(), bob.getId())))
                .thenReturn(List.of(aliceDevice, bobDevice));

        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(10L, 20L)))
                .thenReturn(List.of(aliceSigned, bobSigned));

        ResolvedChatDevicesResponse response = preKeyService.resolveChatDevices("alice", 100L);

        assertThat(response.chatId()).isEqualTo(100L);
        assertThat(response.username()).isEqualTo("alice");
        assertThat(response.currentDeviceId()).isEqualTo("alice-phone");
        assertThat(response.targetDevices()).extracting(DeviceBundleDto::deviceId)
                .containsExactly("alice-phone", "bob-laptop");

        DeviceBundleDto aliceDto = response.targetDevices().get(0);
        assertThat(aliceDto.signedPreKey()).isNotNull();
        assertThat(aliceDto.oneTimePreKey()).isNull();

        DeviceBundleDto bobDto = response.targetDevices().get(1);
        assertThat(bobDto.signedPreKey()).isNotNull();
        assertThat(bobDto.oneTimePreKey()).isNull();
        verify(oneTimePreKeyRepository, never()).findOneAvailableForUpdate(20L);
    }

    @Test
    void resolveChatDevicesSkipsDuplicateDeviceIds() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        UserDevice bobDevice = device(20L, bob, "same-device-id");
        UserDevice duplicateDevice = device(21L, bob, "same-device-id");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, alice.getId()))
                .thenReturn(true);
        when(chatParticipantRepository.findUserIdsByChatId(100L))
                .thenReturn(List.of(alice.getId(), bob.getId()));

        when(userDeviceRepository.findActiveByUserIdsWithUser(List.of(alice.getId(), bob.getId())))
                .thenReturn(List.of(aliceDevice, bobDevice, duplicateDevice));

        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(10L, 20L, 21L)))
                .thenReturn(List.of());

        ResolvedChatDevicesResponse response = preKeyService.resolveChatDevices("alice", 100L);

        assertThat(response.targetDevices()).extracting(DeviceBundleDto::deviceId)
                .containsExactly("alice-phone", "same-device-id");

        verify(oneTimePreKeyRepository, never()).findOneAvailableForUpdate(21L);
    }

    @Test
    void reserveChatDeviceOneTimePreKeyFailsWhenPoolIsEmpty() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        UserDevice bobDevice = device(20L, bob, "bob-phone");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, alice.getId())).thenReturn(true);
        when(userDeviceRepository.findByDeviceIdAndActiveTrueWithUser("bob-phone"))
                .thenReturn(java.util.Optional.of(bobDevice));
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, bob.getId())).thenReturn(true);
        when(signedPreKeyRepository.findLatestByDeviceIds(List.of(20L)))
                .thenReturn(List.of(signedPreKey(bobDevice, 7, "signed-public", "signature")));
        when(oneTimePreKeyRepository.findOneAvailableForUpdate(20L))
                .thenReturn(java.util.Optional.empty());

        assertThatThrownBy(() -> preKeyService.reserveChatDeviceOneTimePreKey("alice", 100L, "bob-phone"))
                .isInstanceOf(ru.messenger.chaosmessenger.common.exception.CryptoException.class)
                .hasMessageContaining("empty");
    }

    private static UserDevice device(Long id, User user, String deviceId) {
        UserDevice device = new UserDevice();
        device.setId(id);
        device.setUser(user);
        device.setDeviceId(deviceId);
        device.setDeviceName("Device " + deviceId);
        device.setRegistrationId(123);
        device.setIdentityPublicKey("identity-" + deviceId);
        device.setSigningPublicKey("signing-" + deviceId);
        device.setActive(true);
        device.setCreatedAt(LocalDateTime.now().minusDays(1));
        device.setLastSeen(LocalDateTime.now());
        return device;
    }

    private static SignedPreKey signedPreKey(UserDevice device, Integer preKeyId, String publicKey, String signature) {
        return SignedPreKey.builder()
                .id(device.getId() * 10)
                .device(device)
                .preKeyId(preKeyId)
                .publicKey(publicKey)
                .signature(signature)
                .createdAt(LocalDateTime.now())
                .build();
    }

    private static OneTimePreKey oneTimePreKey(UserDevice device, Integer preKeyId, String publicKey) {
        return OneTimePreKey.builder()
                .id(device.getId() * 100)
                .device(device)
                .preKeyId(preKeyId)
                .publicKey(publicKey)
                .createdAt(LocalDateTime.now())
                .build();
    }
}



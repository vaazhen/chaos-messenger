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
import java.util.Optional;

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
    void getBundleByUsernameReturnsActiveDeviceBundlesReadOnly() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        SignedPreKey signed = signedPreKey(aliceDevice, 7, "signed-public", "signature");
        OneTimePreKey oneTime = oneTimePreKey(aliceDevice, 101, "otp-public");

        when(userDeviceRepository.findByUserUsernameAndActiveTrue("alice"))
                .thenReturn(List.of(aliceDevice));
        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(10L))
                .thenReturn(Optional.of(signed));
        when(oneTimePreKeyRepository.findAvailableReadOnly(10L))
                .thenReturn(List.of(oneTime));

        PreKeyBundleResponse response = preKeyService.getBundleByUsername("alice");

        assertThat(response.getUsername()).isEqualTo("alice");
        assertThat(response.getDevices()).hasSize(1);

        DeviceBundleDto dto = response.getDevices().get(0);
        assertThat(dto.getUserId()).isEqualTo(alice.getId());
        assertThat(dto.getDeviceDbId()).isEqualTo(10L);
        assertThat(dto.getDeviceId()).isEqualTo("alice-phone");
        assertThat(dto.getRegistrationId()).isEqualTo(123);
        assertThat(dto.getIdentityPublicKey()).isEqualTo("identity-alice-phone");

        assertThat(dto.getSignedPreKey().getPreKeyId()).isEqualTo(7);
        assertThat(dto.getSignedPreKey().getPublicKey()).isEqualTo("signed-public");
        assertThat(dto.getSignedPreKey().getSignature()).isEqualTo("signature");

        assertThat(dto.getOneTimePreKey().getPreKeyId()).isEqualTo(101);
        assertThat(dto.getOneTimePreKey().getPublicKey()).isEqualTo("otp-public");

        verify(oneTimePreKeyRepository, never()).findAvailableForUpdate(10L);
        verify(oneTimePreKeyRepository, never()).save(oneTime);
    }

    @Test
    void getBundleByUsernameAllowsDevicesWithoutAvailablePreKeys() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");

        when(userDeviceRepository.findByUserUsernameAndActiveTrue("alice"))
                .thenReturn(List.of(aliceDevice));
        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(10L))
                .thenReturn(Optional.empty());
        when(oneTimePreKeyRepository.findAvailableReadOnly(10L))
                .thenReturn(List.of());

        PreKeyBundleResponse response = preKeyService.getBundleByUsername("alice");

        DeviceBundleDto dto = response.getDevices().get(0);
        assertThat(dto.getSignedPreKey()).isNull();
        assertThat(dto.getOneTimePreKey()).isNull();
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

        verify(chatParticipantRepository, never()).findByChatId(100L);
    }

    @Test
    void resolveChatDevicesIncludesCurrentDeviceReadOnlyAndReservesOtherParticipantOneTimePreKey() {
        UserDevice aliceDevice = device(10L, alice, "alice-phone");
        UserDevice bobDevice = device(20L, bob, "bob-laptop");

        SignedPreKey aliceSigned = signedPreKey(aliceDevice, 7, "alice-signed", "alice-signature");
        SignedPreKey bobSigned = signedPreKey(bobDevice, 8, "bob-signed", "bob-signature");

        OneTimePreKey aliceOtp = oneTimePreKey(aliceDevice, 101, "alice-otp");
        OneTimePreKey bobOtp = oneTimePreKey(bobDevice, 201, "bob-otp");

        when(userIdentityService.require("alice")).thenReturn(alice);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(aliceDevice);
        when(chatParticipantRepository.existsByChatIdAndUserId(100L, alice.getId()))
                .thenReturn(true);
        when(chatParticipantRepository.findByChatId(100L))
                .thenReturn(List.of(
                        TestFixtures.participant(100L, alice.getId()),
                        TestFixtures.participant(100L, bob.getId())
                ));

        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId()))
                .thenReturn(List.of(aliceDevice));
        when(userDeviceRepository.findByUserIdAndActiveTrue(bob.getId()))
                .thenReturn(List.of(bobDevice));

        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(10L))
                .thenReturn(Optional.of(aliceSigned));
        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(20L))
                .thenReturn(Optional.of(bobSigned));

        when(oneTimePreKeyRepository.findAvailableReadOnly(10L))
                .thenReturn(List.of(aliceOtp));
        when(oneTimePreKeyRepository.findAvailableForUpdate(20L))
                .thenReturn(List.of(bobOtp));

        ResolvedChatDevicesResponse response = preKeyService.resolveChatDevices("alice", 100L);

        assertThat(response.getChatId()).isEqualTo(100L);
        assertThat(response.getUsername()).isEqualTo("alice");
        assertThat(response.getCurrentDeviceId()).isEqualTo("alice-phone");
        assertThat(response.getTargetDevices()).extracting(DeviceBundleDto::getDeviceId)
                .containsExactly("alice-phone", "bob-laptop");

        DeviceBundleDto aliceDto = response.getTargetDevices().get(0);
        assertThat(aliceDto.getOneTimePreKey().getPublicKey()).isEqualTo("alice-otp");

        DeviceBundleDto bobDto = response.getTargetDevices().get(1);
        assertThat(bobDto.getOneTimePreKey().getPublicKey()).isEqualTo("bob-otp");

        assertThat(aliceOtp.getUsedAt()).isNull();
        assertThat(bobOtp.getUsedAt()).isNotNull();

        verify(oneTimePreKeyRepository, never()).save(aliceOtp);
        verify(oneTimePreKeyRepository).save(bobOtp);
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
        when(chatParticipantRepository.findByChatId(100L))
                .thenReturn(List.of(
                        TestFixtures.participant(100L, alice.getId()),
                        TestFixtures.participant(100L, bob.getId())
                ));

        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId()))
                .thenReturn(List.of(aliceDevice));
        when(userDeviceRepository.findByUserIdAndActiveTrue(bob.getId()))
                .thenReturn(List.of(bobDevice, duplicateDevice));

        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(10L))
                .thenReturn(Optional.empty());
        when(signedPreKeyRepository.findTopByDeviceIdOrderByCreatedAtDesc(20L))
                .thenReturn(Optional.empty());

        when(oneTimePreKeyRepository.findAvailableReadOnly(10L))
                .thenReturn(List.of());
        when(oneTimePreKeyRepository.findAvailableForUpdate(20L))
                .thenReturn(List.of());

        ResolvedChatDevicesResponse response = preKeyService.resolveChatDevices("alice", 100L);

        assertThat(response.getTargetDevices()).extracting(DeviceBundleDto::getDeviceId)
                .containsExactly("alice-phone", "same-device-id");

        verify(signedPreKeyRepository, never()).findTopByDeviceIdOrderByCreatedAtDesc(21L);
        verify(oneTimePreKeyRepository, never()).findAvailableForUpdate(21L);
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
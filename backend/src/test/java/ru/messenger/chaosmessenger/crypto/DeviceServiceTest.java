package ru.messenger.chaosmessenger.crypto;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.common.exception.AuthException;
import ru.messenger.chaosmessenger.crypto.device.DeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationRequest;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationResponse;
import ru.messenger.chaosmessenger.crypto.dto.OneTimePreKeyDto;
import ru.messenger.chaosmessenger.crypto.dto.SignedPreKeyDto;
import ru.messenger.chaosmessenger.crypto.dto.UserDeviceResponse;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKey;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKeyRepository;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKey;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKeyRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DeviceServiceTest {

    @Mock UserRepository userRepository;
    @Mock UserIdentityService userIdentityService;
    @Mock UserDeviceRepository userDeviceRepository;
    @Mock SignedPreKeyRepository signedPreKeyRepository;
    @Mock OneTimePreKeyRepository oneTimePreKeyRepository;

    @InjectMocks DeviceService deviceService;

    private User alice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
    }

    @Nested
    class RegisterDevice {

        @Test
        void registersNewDeviceWithSignedPreKeyAndOneTimePreKeys() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());
            when(userDeviceRepository.save(any(UserDevice.class))).thenAnswer(invocation -> {
                UserDevice device = invocation.getArgument(0);
                device.setId(10L);
                return device;
            });
            when(signedPreKeyRepository.findByDeviceIdAndPreKeyId(10L, 7))
                    .thenReturn(Optional.empty());

            DeviceRegistrationResponse response = deviceService.registerDevice("alice", request);

            assertThat(response.getDeviceId()).isEqualTo("dev-1");
            assertThat(response.getServerDeviceInternalId()).isEqualTo(10L);

            ArgumentCaptor<UserDevice> deviceCaptor = ArgumentCaptor.forClass(UserDevice.class);
            verify(userDeviceRepository).save(deviceCaptor.capture());

            UserDevice savedDevice = deviceCaptor.getValue();
            assertThat(savedDevice.getUser()).isSameAs(alice);
            assertThat(savedDevice.getDeviceId()).isEqualTo("dev-1");
            assertThat(savedDevice.getDeviceName()).isEqualTo("Chrome");
            assertThat(savedDevice.getRegistrationId()).isEqualTo(12345);
            assertThat(savedDevice.getIdentityPublicKey()).isEqualTo(request.getIdentityPublicKey());
            assertThat(savedDevice.getSigningPublicKey()).isEqualTo(request.getSigningPublicKey());
            assertThat(savedDevice.isActive()).isTrue();
            assertThat(savedDevice.getLastSeen()).isNotNull();

            ArgumentCaptor<SignedPreKey> signedCaptor = ArgumentCaptor.forClass(SignedPreKey.class);
            verify(signedPreKeyRepository).save(signedCaptor.capture());

            SignedPreKey signed = signedCaptor.getValue();
            assertThat(signed.getDevice()).isSameAs(savedDevice);
            assertThat(signed.getPreKeyId()).isEqualTo(7);
            assertThat(signed.getPublicKey()).isEqualTo(request.getSignedPreKey().getPublicKey());
            assertThat(signed.getSignature()).isEqualTo(request.getSignedPreKey().getSignature());

            verify(oneTimePreKeyRepository).deleteByDeviceId(10L);
            verify(oneTimePreKeyRepository).flush();

            ArgumentCaptor<OneTimePreKey> otpCaptor = ArgumentCaptor.forClass(OneTimePreKey.class);
            verify(oneTimePreKeyRepository).save(otpCaptor.capture());

            OneTimePreKey otp = otpCaptor.getValue();
            assertThat(otp.getDevice()).isSameAs(savedDevice);
            assertThat(otp.getPreKeyId()).isEqualTo(101);
            assertThat(otp.getPublicKey()).isEqualTo(request.getOneTimePreKeys().get(0).getPublicKey());
            assertThat(otp.getUsedAt()).isNull();
        }

        @Test
        void rejectsNewDeviceWithoutOneTimePreKeys() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            request.setOneTimePreKeys(List.of());

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("At least one one-time pre-key is required");

            verify(userDeviceRepository, never()).save(any());
            verify(signedPreKeyRepository, never()).save(any());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsTemporarySignedPreKeySignature() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            request.getSignedPreKey().setSignature("TEMP_SIGNATURE");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());
            when(userDeviceRepository.save(any(UserDevice.class))).thenAnswer(invocation -> {
                UserDevice device = invocation.getArgument(0);
                device.setId(10L);
                return device;
            });

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("signedPreKey.signature must be a real signature");

            verify(signedPreKeyRepository, never()).save(any());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsInvalidSignedPreKeySignature() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            request.getSignedPreKey().setSignature(Base64.getEncoder().encodeToString(new byte[64]));

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());
            when(userDeviceRepository.save(any(UserDevice.class))).thenAnswer(invocation -> {
                UserDevice device = invocation.getArgument(0);
                device.setId(10L);
                return device;
            });

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("signedPreKey.signature verification failed");

            verify(signedPreKeyRepository, never()).save(any());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void updatesExistingDeviceWithoutRequiringOneTimePreKeysWhenSignedPreKeyMaterialIsSame() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            request.setDeviceName("Updated laptop");
            request.setOneTimePreKeys(null);

            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setActive(false);

            SignedPreKey existingSignedPreKey = SignedPreKey.builder()
                    .id(100L)
                    .device(existingDevice)
                    .preKeyId(7)
                    .publicKey(request.getSignedPreKey().getPublicKey())
                    .signature(request.getSignedPreKey().getSignature())
                    .createdAt(LocalDateTime.now().minusDays(1))
                    .build();

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));
            when(userDeviceRepository.save(existingDevice)).thenReturn(existingDevice);
            when(signedPreKeyRepository.findByDeviceIdAndPreKeyId(10L, 7))
                    .thenReturn(Optional.of(existingSignedPreKey));

            DeviceRegistrationResponse response = deviceService.registerDevice("alice", request);

            assertThat(response.getServerDeviceInternalId()).isEqualTo(10L);
            assertThat(existingDevice.isActive()).isTrue();
            assertThat(existingDevice.getDeviceName()).isEqualTo("Updated laptop");
            assertThat(existingDevice.getIdentityPublicKey()).isEqualTo(request.getIdentityPublicKey());

            verify(signedPreKeyRepository, never()).delete(any());
            verify(signedPreKeyRepository, never()).save(any(SignedPreKey.class));
            verify(oneTimePreKeyRepository, never()).deleteByDeviceId(anyLong());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void requiresMandatoryRegistrationFields() {
            DeviceRegistrationRequest request = new DeviceRegistrationRequest();

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("deviceId is required");

            request.setDeviceId("dev-1");
            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("registrationId is required");

            request.setRegistrationId(123);
            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("identityPublicKey is required");

            request.setIdentityPublicKey("identity");
            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("signedPreKey is required");
        }
    }

    @Nested
    class CurrentAndListDevices {

        @Test
        void findCurrentDeviceReturnsEmptyForBlankInput() {
            assertThat(deviceService.findCurrentDevice(null, "dev")).isEmpty();
            assertThat(deviceService.findCurrentDevice("alice", "")).isEmpty();
        }

        @Test
        void findCurrentDeviceReturnsRegistrationResponse() {
            UserDevice device = TestFixtures.device(10L, alice.getId(), "dev-1");

            when(userDeviceRepository.findByUserUsernameAndDeviceIdAndActiveTrue("alice", "dev-1"))
                    .thenReturn(Optional.of(device));

            assertThat(deviceService.findCurrentDevice("alice", "dev-1"))
                    .hasValueSatisfying(response -> {
                        assertThat(response.getDeviceId()).isEqualTo("dev-1");
                        assertThat(response.getServerDeviceInternalId()).isEqualTo(10L);
                    });
        }

        @Test
        void listMyDevicesSortsActiveFirstThenRecentAndMarksCurrent() {
            UserDevice inactiveRecent = TestFixtures.device(1L, alice.getId(), "inactive");
            inactiveRecent.setActive(false);
            inactiveRecent.setLastSeen(LocalDateTime.now());

            UserDevice activeOld = TestFixtures.device(2L, alice.getId(), "active-old");
            activeOld.setActive(true);
            activeOld.setLastSeen(LocalDateTime.now().minusDays(2));

            UserDevice activeCurrent = TestFixtures.device(3L, alice.getId(), "active-current");
            activeCurrent.setActive(true);
            activeCurrent.setLastSeen(LocalDateTime.now().minusHours(1));

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserIdOrderByCreatedAtDesc(alice.getId()))
                    .thenReturn(List.of(inactiveRecent, activeOld, activeCurrent));

            List<UserDeviceResponse> response = deviceService.listMyDevices("alice", "active-current");

            assertThat(response).extracting(UserDeviceResponse::deviceId)
                    .containsExactly("active-current", "active-old", "inactive");

            assertThat(response.get(0).current()).isTrue();
            assertThat(response.get(1).current()).isFalse();
            assertThat(response.get(2).active()).isFalse();
        }
    }

    @Nested
    class DeactivateDevice {

        @Test
        void returnsInactiveDeviceWithoutSavingAgain() {
            UserDevice inactive = TestFixtures.device(10L, alice.getId(), "dev-1");
            inactive.setActive(false);

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByIdAndUserId(10L, alice.getId()))
                    .thenReturn(Optional.of(inactive));

            UserDeviceResponse response = deviceService.deactivateDevice("alice", 10L, false, "dev-1");

            assertThat(response.id()).isEqualTo(10L);
            assertThat(response.active()).isFalse();
            assertThat(response.current()).isTrue();

            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void rejectsLastActiveDeviceWithoutConfirmation() {
            UserDevice active = TestFixtures.device(10L, alice.getId(), "dev-1");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByIdAndUserId(10L, alice.getId()))
                    .thenReturn(Optional.of(active));
            when(userDeviceRepository.countByUserIdAndActiveTrue(alice.getId()))
                    .thenReturn(1L);

            assertThatThrownBy(() -> deviceService.deactivateDevice("alice", 10L, false, "dev-1"))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("Cannot deactivate the last active device");

            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void deactivatesDeviceWhenConfirmed() {
            UserDevice active = TestFixtures.device(10L, alice.getId(), "dev-1");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByIdAndUserId(10L, alice.getId()))
                    .thenReturn(Optional.of(active));
            when(userDeviceRepository.countByUserIdAndActiveTrue(alice.getId()))
                    .thenReturn(1L);
            when(userDeviceRepository.save(active)).thenReturn(active);

            UserDeviceResponse response = deviceService.deactivateDevice("alice", 10L, true, "other-device");

            assertThat(response.id()).isEqualTo(10L);
            assertThat(response.active()).isFalse();
            assertThat(response.current()).isFalse();
            assertThat(active.getLastSeen()).isNotNull();

            verify(userDeviceRepository).save(active);
        }

        @Test
        void rejectsUnknownDevice() {
            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByIdAndUserId(404L, alice.getId()))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> deviceService.deactivateDevice("alice", 404L, true, "dev"))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("Device not found");
        }
    }

    private static DeviceRegistrationRequest validRegistrationRequest(String deviceId) throws Exception {
        KeyPair signingKeyPair = signingKeyPair();

        byte[] signedPreKeyPublicBytes = randomBytes(32);
        byte[] oneTimePreKeyPublicBytes = randomBytes(32);

        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(signingKeyPair.getPrivate());
        signer.update(signedPreKeyPublicBytes);

        SignedPreKeyDto signedPreKey = new SignedPreKeyDto();
        signedPreKey.setPreKeyId(7);
        signedPreKey.setPublicKey(b64(signedPreKeyPublicBytes));
        signedPreKey.setSignature(b64(signer.sign()));

        OneTimePreKeyDto oneTimePreKey = new OneTimePreKeyDto();
        oneTimePreKey.setPreKeyId(101);
        oneTimePreKey.setPublicKey(b64(oneTimePreKeyPublicBytes));

        DeviceRegistrationRequest request = new DeviceRegistrationRequest();
        request.setDeviceId(deviceId);
        request.setDeviceName("Chrome");
        request.setRegistrationId(12345);
        request.setIdentityPublicKey(b64(randomBytes(32)));
        request.setSigningPublicKey(b64(signingKeyPair.getPublic().getEncoded()));
        request.setSignedPreKey(signedPreKey);
        request.setOneTimePreKeys(List.of(oneTimePreKey));
        return request;
    }

    private static KeyPair signingKeyPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    private static byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    private static String b64(byte[] bytes) {
        return Base64.getEncoder().encodeToString(bytes);
    }
}
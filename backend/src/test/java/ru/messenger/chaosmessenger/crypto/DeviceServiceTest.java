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
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.common.exception.AuthException;
import ru.messenger.chaosmessenger.crypto.device.DeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.*;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKey;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKeyRepository;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKey;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKeyRepository;
import ru.messenger.chaosmessenger.outbox.OutboxService;
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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class DeviceServiceTest {

    @Mock
    UserRepository userRepository;
    @Mock
    UserIdentityService userIdentityService;
    @Mock
    UserDeviceRepository userDeviceRepository;
    @Mock
    SignedPreKeyRepository signedPreKeyRepository;
    @Mock
    OneTimePreKeyRepository oneTimePreKeyRepository;
    @Mock
    OutboxService outboxService;
    @Mock
    RefreshTokenService refreshTokenService;

    @InjectMocks
    DeviceService deviceService;

    private User alice;
    private User bob;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        bob = TestFixtures.user(2L, "bob");
        lenient().when(oneTimePreKeyRepository.findByDeviceIdAndPreKeyId(anyLong(), any()))
                .thenReturn(Optional.empty());
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

            assertThat(response.deviceId()).isEqualTo("dev-1");
            assertThat(response.serverDeviceInternalId()).isEqualTo(10L);

            ArgumentCaptor<UserDevice> deviceCaptor = ArgumentCaptor.forClass(UserDevice.class);
            verify(userDeviceRepository).save(deviceCaptor.capture());

            UserDevice savedDevice = deviceCaptor.getValue();
            assertThat(savedDevice.getUser()).isSameAs(alice);
            assertThat(savedDevice.getDeviceId()).isEqualTo("dev-1");
            assertThat(savedDevice.getDeviceName()).isEqualTo("Chrome");
            assertThat(savedDevice.getRegistrationId()).isEqualTo(12345);
            assertThat(savedDevice.getIdentityPublicKey()).isEqualTo(request.identityPublicKey());
            assertThat(savedDevice.getSigningPublicKey()).isEqualTo(request.signingPublicKey());
            assertThat(savedDevice.isActive()).isTrue();
            assertThat(savedDevice.getLastSeen()).isNotNull();

            ArgumentCaptor<SignedPreKey> signedCaptor = ArgumentCaptor.forClass(SignedPreKey.class);
            verify(signedPreKeyRepository).save(signedCaptor.capture());

            SignedPreKey signed = signedCaptor.getValue();
            assertThat(signed.getDevice()).isSameAs(savedDevice);
            assertThat(signed.getPreKeyId()).isEqualTo(7);
            assertThat(signed.getPublicKey()).isEqualTo(request.signedPreKey().publicKey());
            assertThat(signed.getSignature()).isEqualTo(request.signedPreKey().signature());

            verify(oneTimePreKeyRepository).deleteByDeviceIdAndUsedAtIsNull(10L);
            verify(oneTimePreKeyRepository).flush();

            ArgumentCaptor<Iterable> otpCaptor = ArgumentCaptor.forClass(Iterable.class);
            verify(oneTimePreKeyRepository).saveAll(otpCaptor.capture());

            List<OneTimePreKey> capturedPreKeys = new java.util.ArrayList<>();
            otpCaptor.getValue().forEach(value -> capturedPreKeys.add((OneTimePreKey) value));
            assertThat(capturedPreKeys).hasSize(1);
            OneTimePreKey otp = capturedPreKeys.get(0);
            assertThat(otp.getDevice()).isSameAs(savedDevice);
            assertThat(otp.getPreKeyId()).isEqualTo(101);
            assertThat(otp.getPublicKey()).isEqualTo(request.oneTimePreKeys().get(0).publicKey());
            assertThat(otp.getUsedAt()).isNull();
        }

        @Test
        void rejectsNewDeviceWithoutOneTimePreKeys() throws Exception {
            DeviceRegistrationRequest baseRequest = validRegistrationRequest("dev-1");
            DeviceRegistrationRequest request = withOneTimePreKeys(baseRequest, List.of());

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
        void rejectsInvalidSignedPreKeySignature() throws Exception {
            DeviceRegistrationRequest baseRequest = validRegistrationRequest("dev-1");
            DeviceRegistrationRequest request = withSignature(baseRequest, Base64.getEncoder().encodeToString(new byte[64]));

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
        void rejectsDeviceIdOwnedByAnotherUserBeforeInsert() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            UserDevice bobDevice = TestFixtures.device(20L, bob.getId(), "dev-1");
            bobDevice.setUser(bob);

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());
            when(userDeviceRepository.findByDeviceId("dev-1"))
                    .thenReturn(Optional.of(bobDevice));

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("Device id is already registered to another account");

            verify(userDeviceRepository, never()).save(any());
            verify(signedPreKeyRepository, never()).save(any());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsDuplicateOneTimePreKeyIdsBeforeReplacingStoredKeys() throws Exception {
            DeviceRegistrationRequest baseRequest = validRegistrationRequest("dev-1");
            OneTimePreKeyDto key = baseRequest.oneTimePreKeys().get(0);
            DeviceRegistrationRequest request = withOneTimePreKeys(baseRequest, List.of(key, key));

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

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Duplicate one-time pre-key id: 101");

            verify(oneTimePreKeyRepository, never()).deleteByDeviceId(anyLong());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsNinthActiveDevice() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-9");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-9"))
                    .thenReturn(Optional.empty());
            when(userDeviceRepository.countByUserIdAndActiveTrue(alice.getId())).thenReturn(8L);

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("8");
            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void rejectsReactivatingNinthActiveDevice() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setActive(false);
            existingDevice.setIdentityPublicKey(request.identityPublicKey());
            existingDevice.setSigningPublicKey(request.signingPublicKey());

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));
            when(userDeviceRepository.countByUserIdAndActiveTrue(alice.getId())).thenReturn(8L);

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("8");
            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void updatesExistingDeviceWithoutRequiringOneTimePreKeysWhenSignedPreKeyMaterialIsSame() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            request = new DeviceRegistrationRequest(
                    request.deviceId(),
                    "Updated laptop",
                    request.registrationId(),
                    request.identityPublicKey(),
                    request.signingPublicKey(),
                    request.signedPreKey(),
                    null
            );

            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setActive(false);
            existingDevice.setIdentityPublicKey(request.identityPublicKey());
            existingDevice.setSigningPublicKey(request.signingPublicKey());

            SignedPreKey existingSignedPreKey = SignedPreKey.builder()
                    .id(100L)
                    .device(existingDevice)
                    .preKeyId(7)
                    .publicKey(request.signedPreKey().publicKey())
                    .signature(request.signedPreKey().signature())
                    .createdAt(LocalDateTime.now().minusDays(1))
                    .build();

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));
            when(userDeviceRepository.save(existingDevice)).thenReturn(existingDevice);
            when(signedPreKeyRepository.findByDeviceIdAndPreKeyId(10L, 7))
                    .thenReturn(Optional.of(existingSignedPreKey));

            DeviceRegistrationResponse response = deviceService.registerDevice("alice", request);

            assertThat(response.serverDeviceInternalId()).isEqualTo(10L);
            assertThat(existingDevice.isActive()).isTrue();
            assertThat(existingDevice.getDeviceName()).isEqualTo("Updated laptop");
            assertThat(existingDevice.getIdentityPublicKey()).isEqualTo(request.identityPublicKey());

            verify(signedPreKeyRepository, never()).delete(any());
            verify(signedPreKeyRepository, never()).save(any(SignedPreKey.class));
            verify(oneTimePreKeyRepository, never()).deleteByDeviceId(anyLong());
            verify(oneTimePreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsIdentityOverwriteOnExistingDevice() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setIdentityPublicKey(b64(randomBytes(32)));
            existingDevice.setSigningPublicKey(request.signingPublicKey());

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("identity keys cannot be rotated");

            verify(userDeviceRepository, never()).save(any());
            verify(signedPreKeyRepository, never()).save(any());
        }

        @Test
        void rejectsIdentityBindWhenStoredKeysAreBlank() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");
            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setIdentityPublicKey("  ");
            existingDevice.setSigningPublicKey("");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("identity keys cannot be rotated");
            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void rejectsJwtRebindOfRevokedDevice() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setActive(false);
            existingDevice.setIdentityPublicKey(request.identityPublicKey());
            existingDevice.setSigningPublicKey(request.signingPublicKey());

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request, false))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("Revoked");

            assertThat(existingDevice.isActive()).isFalse();
            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void allowsJwtRebindWhenActiveDeviceIdentityKeysMatch() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            UserDevice existingDevice = TestFixtures.device(10L, alice.getId(), "dev-1");
            existingDevice.setUser(alice);
            existingDevice.setActive(true);
            existingDevice.setIdentityPublicKey(request.identityPublicKey());
            existingDevice.setSigningPublicKey(request.signingPublicKey());

            SignedPreKey existingSignedPreKey = SignedPreKey.builder()
                    .id(100L)
                    .device(existingDevice)
                    .preKeyId(7)
                    .publicKey(request.signedPreKey().publicKey())
                    .signature(request.signedPreKey().signature())
                    .createdAt(LocalDateTime.now().minusDays(1))
                    .build();

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(existingDevice));
            when(userDeviceRepository.save(existingDevice)).thenReturn(existingDevice);
            when(signedPreKeyRepository.findByDeviceIdAndPreKeyId(10L, 7))
                    .thenReturn(Optional.of(existingSignedPreKey));

            DeviceRegistrationResponse response = deviceService.registerDevice("alice", request, false);

            assertThat(response.serverDeviceInternalId()).isEqualTo(10L);
            assertThat(existingDevice.isActive()).isTrue();
            verify(userDeviceRepository).save(existingDevice);
        }

        @Test
        void rejectsNewDeviceWithoutEnrollmentToken() throws Exception {
            DeviceRegistrationRequest request = validRegistrationRequest("dev-1");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.empty());

            assertThatThrownBy(() -> deviceService.registerDevice("alice", request, false))
                    .isInstanceOf(AuthException.class)
                    .hasMessageContaining("login registration token");

            verify(userDeviceRepository, never()).save(any());
        }

        @Test
        void requiresMandatoryRegistrationFields() {
            DeviceRegistrationRequest missingDeviceId = new DeviceRegistrationRequest(
                    null, null, null, null, null, null, null);

            assertThatThrownBy(() -> deviceService.registerDevice("alice", missingDeviceId))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("deviceId is required");

            DeviceRegistrationRequest missingRegistrationId = new DeviceRegistrationRequest("dev-1", null, null, null, null, null, null);
            assertThatThrownBy(() -> deviceService.registerDevice("alice", missingRegistrationId))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("registrationId is required");

            DeviceRegistrationRequest missingIdentityPublicKey = new DeviceRegistrationRequest("dev-1", null, 123, null, null, null, null);
            assertThatThrownBy(() -> deviceService.registerDevice("alice", missingIdentityPublicKey))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("identityPublicKey is required");

            DeviceRegistrationRequest missingSignedPreKey = new DeviceRegistrationRequest("dev-1", null, 123, "identity", null, null, null);
            assertThatThrownBy(() -> deviceService.registerDevice("alice", missingSignedPreKey))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("signedPreKey is required");
        }
    }

    @Nested
    class CurrentAndListDevices {

        @Test
        void currentDeviceStateDistinguishesActiveRevokedAndMissing() {
            UserDevice active = TestFixtures.device(10L, alice.getId(), "dev-1");
            UserDevice revoked = TestFixtures.device(11L, alice.getId(), "dev-2");
            revoked.setActive(false);

            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-1"))
                    .thenReturn(Optional.of(active));
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-2"))
                    .thenReturn(Optional.of(revoked));
            when(userDeviceRepository.findByUserUsernameAndDeviceId("alice", "dev-3"))
                    .thenReturn(Optional.empty());

            assertThat(deviceService.currentDeviceState("alice", "dev-1"))
                    .isEqualTo(DeviceService.CurrentDeviceState.ACTIVE);
            assertThat(deviceService.currentDeviceState("alice", "dev-2"))
                    .isEqualTo(DeviceService.CurrentDeviceState.REVOKED);
            assertThat(deviceService.currentDeviceState("alice", "dev-3"))
                    .isEqualTo(DeviceService.CurrentDeviceState.MISSING);
            assertThat(deviceService.currentDeviceState("alice", "")).isEqualTo(DeviceService.CurrentDeviceState.MISSING);
        }

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
                        assertThat(response.deviceId()).isEqualTo("dev-1");
                        assertThat(response.serverDeviceInternalId()).isEqualTo(10L);
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
            when(userDeviceRepository.findByUserIdOrderByActiveDescLastSeenDescCreatedAtDescIdDesc(alice.getId()))
                    .thenReturn(List.of(activeCurrent, activeOld, inactiveRecent));

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
            verify(refreshTokenService, never()).revokeFamily(any());
            verify(outboxService).write(
                    eq("device"),
                    eq("dev-1"),
                    eq("DEVICE_REVOKED"),
                    any(),
                    isNull(),
                    eq("device:1:dev-1:REVOKED")
            );
        }

        @Test
        void revokesBoundRefreshFamilyWhenDeviceIsDeactivated() {
            UserDevice active = TestFixtures.device(10L, alice.getId(), "dev-1");
            active.setSessionFamilyId("family-stolen");

            when(userIdentityService.require("alice")).thenReturn(alice);
            when(userDeviceRepository.findByIdAndUserId(10L, alice.getId()))
                    .thenReturn(Optional.of(active));
            when(userDeviceRepository.countByUserIdAndActiveTrue(alice.getId()))
                    .thenReturn(2L);
            when(userDeviceRepository.save(active)).thenReturn(active);

            UserDeviceResponse response = deviceService.deactivateDevice("alice", 10L, false, "other-device");

            assertThat(response.active()).isFalse();
            assertThat(active.getSessionFamilyId()).isNull();
            verify(refreshTokenService).revokeFamily("family-stolen");
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

        SignedPreKeyDto signedPreKey = new SignedPreKeyDto(7, b64(signedPreKeyPublicBytes), b64(signer.sign()));
        OneTimePreKeyDto oneTimePreKey = new OneTimePreKeyDto(101, b64(oneTimePreKeyPublicBytes));

        return new DeviceRegistrationRequest(
                deviceId,
                "Chrome",
                12345,
                b64(randomBytes(32)),
                b64(signingKeyPair.getPublic().getEncoded()),
                signedPreKey,
                List.of(oneTimePreKey)
        );
    }

    private static DeviceRegistrationRequest withSignature(DeviceRegistrationRequest request, String signature) {
        return new DeviceRegistrationRequest(
                request.deviceId(),
                request.deviceName(),
                request.registrationId(),
                request.identityPublicKey(),
                request.signingPublicKey(),
                new SignedPreKeyDto(request.signedPreKey().preKeyId(), request.signedPreKey().publicKey(), signature),
                request.oneTimePreKeys()
        );
    }

    private static DeviceRegistrationRequest withOneTimePreKeys(
            DeviceRegistrationRequest request,
            List<OneTimePreKeyDto> oneTimePreKeys
    ) {
        return new DeviceRegistrationRequest(
                request.deviceId(),
                request.deviceName(),
                request.registrationId(),
                request.identityPublicKey(),
                request.signingPublicKey(),
                request.signedPreKey(),
                oneTimePreKeys
        );
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

package ru.messenger.chaosmessenger.crypto.device;

import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;
import ru.messenger.chaosmessenger.common.exception.AuthException;
import ru.messenger.chaosmessenger.common.exception.CryptoException;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationRequest;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationResponse;
import ru.messenger.chaosmessenger.crypto.dto.OneTimePreKeyDto;
import ru.messenger.chaosmessenger.crypto.dto.UserDeviceResponse;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKey;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKeyRepository;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKey;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKeyRepository;
import ru.messenger.chaosmessenger.outbox.OutboxIds;
import ru.messenger.chaosmessenger.outbox.OutboxService;
import ru.messenger.chaosmessenger.user.domain.User;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class DeviceService {

    private final UserIdentityService userIdentityService;
    private final UserDeviceRepository userDeviceRepository;
    private final SignedPreKeyRepository signedPreKeyRepository;
    private final OneTimePreKeyRepository oneTimePreKeyRepository;
    private final OutboxService outboxService;
    private final RefreshTokenService refreshTokenService;

    public enum CurrentDeviceState {
        ACTIVE,
        REVOKED,
        MISSING
    }

    @Transactional(readOnly = true)
    public CurrentDeviceState currentDeviceState(String username, String deviceId) {
        if (username == null || username.isBlank() || deviceId == null || deviceId.isBlank()) {
            return CurrentDeviceState.MISSING;
        }
        return userDeviceRepository.findByUserUsernameAndDeviceId(username, deviceId)
                .map(device -> device.isActive() ? CurrentDeviceState.ACTIVE : CurrentDeviceState.REVOKED)
                .orElse(CurrentDeviceState.MISSING);
    }

    @Transactional(readOnly = true)
    public Optional<DeviceRegistrationResponse> findCurrentDevice(String username, String deviceId) {
        if (username == null || username.isBlank() || deviceId == null || deviceId.isBlank()) {
            return Optional.empty();
        }

        return userDeviceRepository
                .findByUserUsernameAndDeviceIdAndActiveTrue(username, deviceId)
                .map(device -> new DeviceRegistrationResponse(device.getDeviceId(), device.getId()));
    }

    @Transactional
    public DeviceRegistrationResponse registerDevice(String username, DeviceRegistrationRequest request) {
        return registerDevice(username, request, true);
    }

    /**
     * @param allowNewDevice {@code true} only when the caller consumed a login-issued
     *                       registration token. JWT re-bind may update an existing
     *                       device whose identity keys still match; it must not
     *                       enroll a new device or rotate identity keys.
     */
    @Transactional
    public DeviceRegistrationResponse registerDevice(
            String username,
            DeviceRegistrationRequest request,
            boolean allowNewDevice
    ) {
        if (request.deviceId() == null || request.deviceId().isBlank()) {
            throw new IllegalArgumentException("deviceId is required");
        }
        if (request.registrationId() == null) {
            throw new IllegalArgumentException("registrationId is required");
        }
        if (request.identityPublicKey() == null || request.identityPublicKey().isBlank()) {
            throw new IllegalArgumentException("identityPublicKey is required");
        }
        if (request.signedPreKey() == null) {
            throw new IllegalArgumentException("signedPreKey is required");
        }

        User user = userIdentityService.require(username);

        Optional<UserDevice> existingDevice = userDeviceRepository
                .findByUserUsernameAndDeviceId(username, request.deviceId());

        if (existingDevice.isEmpty()) {
            if (!allowNewDevice) {
                throw new AuthException("New device enrollment requires a login registration token");
            }
            userDeviceRepository.findByDeviceId(request.deviceId())
                    .ifPresent(device -> {
                        Long ownerId = device.getUser() == null ? null : device.getUser().getId();
                        if (!user.getId().equals(ownerId)) {
                            throw new IllegalStateException(
                                    "Device id is already registered to another account. Reset local device identity and retry.");
                        }
                    });
        } else {
            UserDevice existing = existingDevice.get();
            if (!existing.isActive() && !allowNewDevice) {
                throw new AuthException(
                        "Revoked device cannot be reactivated without a login registration token",
                        "DEVICE_REVOKED"
                );
            }
            assertUnchangedIdentity(existing, request);
        }

        boolean newDevice = existingDevice.isEmpty();
        boolean reactivating = !newDevice && !existingDevice.get().isActive();
        if (newDevice && (request.oneTimePreKeys() == null || request.oneTimePreKeys().isEmpty())) {
            throw new IllegalArgumentException("At least one one-time pre-key is required");
        }
        if ((newDevice || reactivating)
                && userDeviceRepository.countByUserIdAndActiveTrue(user.getId()) >= DeviceLimits.MAX_ACTIVE_DEVICES) {
            throw new AuthException("Cannot register more than " + DeviceLimits.MAX_ACTIVE_DEVICES + " active devices");
        }

        UserDevice device = existingDevice
                .orElseGet(() -> UserDevice.builder()
                        .user(user)
                        .deviceId(request.deviceId())
                        .createdAt(LocalDateTime.now())
                        .active(true)
                        .build());

        device.setDeviceName(request.deviceName());
        device.setRegistrationId(request.registrationId());
        device.setIdentityPublicKey(request.identityPublicKey());
        device.setSigningPublicKey(request.signingPublicKey());
        device.setLastSeen(LocalDateTime.now());
        device.setActive(true);

        device = userDeviceRepository.save(device);

        upsertSignedPreKey(device, request);
        replaceOneTimePreKeys(device, request);

        return new DeviceRegistrationResponse(device.getDeviceId(), device.getId());
    }

    @Transactional(readOnly = true)
    public java.util.List<UserDeviceResponse> listMyDevices(String username, String currentDeviceId) {
        User user = userIdentityService.require(username);

        return userDeviceRepository.findByUserIdOrderByActiveDescLastSeenDescCreatedAtDescIdDesc(user.getId()).stream()
                .map(device -> toResponse(device, currentDeviceId))
                .toList();
    }

    @Transactional
    public UserDeviceResponse deactivateDevice(
            String username,
            Long internalDeviceId,
            boolean confirmLastDevice,
            String currentDeviceId
    ) {
        User user = userIdentityService.require(username);

        UserDevice device = userDeviceRepository.findByIdAndUserId(internalDeviceId, user.getId())
                .orElseThrow(() -> new AuthException("Device not found"));

        if (!device.isActive()) {
            return toResponse(device, currentDeviceId);
        }

        long activeCount = userDeviceRepository.countByUserIdAndActiveTrue(user.getId());

        if (activeCount <= 1 && !confirmLastDevice) {
            throw new AuthException("Cannot deactivate the last active device without confirmation");
        }

        device.setActive(false);
        device.setLastSeen(LocalDateTime.now());
        String boundFamily = device.getSessionFamilyId();
        device.setSessionFamilyId(null);

        UserDevice saved = userDeviceRepository.save(device);
        if (boundFamily != null && !boundFamily.isBlank()) {
            refreshTokenService.revokeFamily(boundFamily);
        }
        outboxService.write(
                "device",
                saved.getDeviceId(),
                "DEVICE_REVOKED",
                java.util.Map.of(
                        "deviceId", saved.getDeviceId(),
                        "reason", "device_revoked",
                        "participantUsernames", java.util.List.of(username)
                ),
                null,
                OutboxIds.key("device", user.getId(), saved.getDeviceId(), "REVOKED")
        );
        return toResponse(saved, currentDeviceId);
    }

    @Transactional(readOnly = true)
    public int availableOneTimePreKeys(UserDevice device) {
        return Math.toIntExact(oneTimePreKeyRepository.countByDeviceIdAndUsedAtIsNull(device.getId()));
    }

    @Transactional
    public int appendOneTimePreKeys(UserDevice device, List<OneTimePreKeyDto> keys) {
        if (keys == null || keys.isEmpty()) {
            throw new IllegalArgumentException("At least one one-time pre-key is required");
        }
        Set<Integer> requestIds = new HashSet<>();
        for (OneTimePreKeyDto dto : keys) {
            if (dto.preKeyId() == null || dto.publicKey() == null || dto.publicKey().isBlank()) {
                throw new IllegalArgumentException("One-time pre-key id and public key are required");
            }
            if (!requestIds.add(dto.preKeyId())) {
                throw new IllegalArgumentException("Duplicate one-time pre-key id: " + dto.preKeyId());
            }

            Optional<OneTimePreKey> existing = oneTimePreKeyRepository
                    .findByDeviceIdAndPreKeyId(device.getId(), dto.preKeyId());
            if (existing.isPresent()) {
                if (!existing.get().getPublicKey().equals(dto.publicKey())) {
                    throw new IllegalArgumentException(
                            "One-time pre-key id already exists with different key material: " + dto.preKeyId());
                }
                continue;
            }

            oneTimePreKeyRepository.save(OneTimePreKey.builder()
                    .device(device)
                    .preKeyId(dto.preKeyId())
                    .publicKey(dto.publicKey())
                    .createdAt(LocalDateTime.now())
                    .build());
        }
        oneTimePreKeyRepository.flush();
        return Math.toIntExact(oneTimePreKeyRepository.countByDeviceIdAndUsedAtIsNull(device.getId()));
    }

    private void assertUnchangedIdentity(
            UserDevice existing,
            DeviceRegistrationRequest request
    ) {
        boolean storedIdentity = existing.getIdentityPublicKey() != null && !existing.getIdentityPublicKey().isBlank();
        boolean storedSigning = existing.getSigningPublicKey() != null && !existing.getSigningPublicKey().isBlank();
        if (!storedIdentity || !storedSigning) {
            throw new IllegalStateException(
                    "Device identity keys cannot be rotated. Register a new device id instead.");
        }
        if (!sameKeyMaterial(existing.getIdentityPublicKey(), request.identityPublicKey())
                || !sameKeyMaterial(existing.getSigningPublicKey(), request.signingPublicKey())) {
            throw new IllegalStateException(
                    "Device identity keys cannot be rotated. Register a new device id instead.");
        }
    }

    private static boolean sameKeyMaterial(String stored, String incoming) {
        return MessageDigest.isEqual(sha256(stored), sha256(incoming));
    }

    private static byte[] sha256(String value) {
        String material = value == null ? "" : value;
        try {
            return MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private UserDeviceResponse toResponse(UserDevice device, String currentDeviceId) {
        return new UserDeviceResponse(
                device.getId(),
                device.getDeviceId(),
                device.getDeviceName(),
                device.isActive(),
                currentDeviceId != null && currentDeviceId.equals(device.getDeviceId()),
                device.getLastSeen(),
                device.getCreatedAt()
        );
    }

    private void upsertSignedPreKey(UserDevice device, DeviceRegistrationRequest request) {
        Integer preKeyId  = request.signedPreKey().preKeyId();
        String publicKey  = request.signedPreKey().publicKey();
        String signature  = request.signedPreKey().signature();

        if (publicKey == null || publicKey.isBlank()) {
            throw new IllegalArgumentException("signedPreKey.publicKey is required");
        }
        if (signature == null || signature.isBlank()) {
            throw new IllegalArgumentException("signedPreKey.signature is required");
        }
        verifySignedPreKeySignature(device.getSigningPublicKey(), publicKey, signature);

        Optional<SignedPreKey> existingOpt = signedPreKeyRepository.findByDeviceIdAndPreKeyId(device.getId(), preKeyId);
        if (existingOpt.isPresent()) {
            SignedPreKey existing = existingOpt.get();
            boolean sameMaterial = publicKey.equals(existing.getPublicKey())
                    && signature.equals(existing.getSignature());
            if (sameMaterial) {
                return;
            }
            signedPreKeyRepository.delete(existing);
            signedPreKeyRepository.flush();
        }

        SignedPreKey signedPreKey = SignedPreKey.builder()
                .device(device)
                .preKeyId(preKeyId)
                .publicKey(publicKey)
                .signature(signature)
                .createdAt(LocalDateTime.now())
                .build();
        signedPreKeyRepository.save(signedPreKey);
    }

    /**
     * Verifies the ECDSA P-256 signature of the SignedPreKey.
     *
     * <p>The client (WebCrypto) generates the signature via {@code crypto.subtle.sign("ECDSA/P-256/SHA-256")},
     * which returns it in IEEE P1363 format (64 bytes: r || s, 32 bytes each).
     * Java's {@code SHA256withECDSA} expects DER (ASN.1 SEQUENCE { INTEGER r, INTEGER s }),
     * so a format conversion is performed before verification.
     *
     * @param signingPublicKeySpkiB64  Base64-encoded SPKI public key (ECDSA P-256)
     * @param signedPreKeyPublicB64    Base64-encoded raw public bytes of the SignedPreKey (X25519, 32 bytes)
     * @param signatureB64             Base64-encoded P1363 signature (64 bytes)
     * @throws IllegalArgumentException if the signature fails verification or the key is malformed
     */
    private void verifySignedPreKeySignature(String signingPublicKeySpkiB64,
                                             String signedPreKeyPublicB64,
                                             String signatureB64) {
        if (signingPublicKeySpkiB64 == null || signingPublicKeySpkiB64.isBlank()) {
            throw new IllegalArgumentException(
                    "signingPublicKey is required for SignedPreKey verification. " +
                    "Update your crypto-engine.js to the version with ECDSA P-256 signing key.");
        }
        try {
            byte[] spkiBytes       = Base64.getDecoder().decode(signingPublicKeySpkiB64);
            byte[] signedPreKeyBytes = Base64.getDecoder().decode(signedPreKeyPublicB64);
            byte[] p1363Signature  = Base64.getDecoder().decode(signatureB64);

            // Parse the SPKI key using standard JCA — no Bouncy Castle needed
            KeyFactory keyFactory = KeyFactory.getInstance("EC");
            java.security.PublicKey publicKey = keyFactory.generatePublic(new X509EncodedKeySpec(spkiBytes));

            // WebCrypto → Java: convert P1363 (r||s) to DER (SEQUENCE { INTEGER r, INTEGER s })
            byte[] derSignature = p1363ToDer(p1363Signature);

            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey);
            verifier.update(signedPreKeyBytes);

            if (!verifier.verify(derSignature)) {
                throw new IllegalArgumentException("signedPreKey.signature verification failed");
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new CryptoException(
                    "Failed to verify signed prekey signature: " + e.getMessage(), e);
        }
    }

    /**
     * Converts an ECDSA signature from P1363 (IEEE) format to DER (ASN.1).
     *
     * <p>The WebCrypto API returns signatures as {@code r || s} (32 bytes each for P-256).
     * Java's SHA256withECDSA expects {@code SEQUENCE { INTEGER r, INTEGER s }} in DER encoding.
     */
    private static byte[] p1363ToDer(byte[] p1363) {
        if (p1363.length != 64) {
            throw new IllegalArgumentException(
                    "Expected 64-byte P1363 signature for P-256, got " + p1363.length);
        }
        // BigInteger(1, bytes) — positive, sign ignored — correct for r and s
        BigInteger r = new BigInteger(1, Arrays.copyOfRange(p1363, 0, 32));
        BigInteger s = new BigInteger(1, Arrays.copyOfRange(p1363, 32, 64));

        byte[] rBytes = r.toByteArray(); // toByteArray() prepends a 0x00 byte when the high bit is set
        byte[] sBytes = s.toByteArray();

        // Build DER: SEQUENCE { INTEGER r, INTEGER s }
        int seqLen = 2 + rBytes.length + 2 + sBytes.length;
        byte[] der = new byte[2 + seqLen];
        int pos = 0;
        der[pos++] = 0x30; // SEQUENCE tag
        der[pos++] = (byte) seqLen;
        der[pos++] = 0x02; // INTEGER tag
        der[pos++] = (byte) rBytes.length;
        System.arraycopy(rBytes, 0, der, pos, rBytes.length);
        pos += rBytes.length;
        der[pos++] = 0x02; // INTEGER tag
        der[pos++] = (byte) sBytes.length;
        System.arraycopy(sBytes, 0, der, pos, sBytes.length);
        return der;
    }

    private void replaceOneTimePreKeys(UserDevice device, DeviceRegistrationRequest request) {
        if (request.oneTimePreKeys() == null || request.oneTimePreKeys().isEmpty()) {
            return;
        }

        validateOneTimePreKeys(request);

        oneTimePreKeyRepository.deleteByDeviceIdAndUsedAtIsNull(device.getId());
        oneTimePreKeyRepository.flush();

        List<OneTimePreKey> preKeys = request.oneTimePreKeys().stream()
                .filter(dto -> oneTimePreKeyRepository
                        .findByDeviceIdAndPreKeyId(device.getId(), dto.preKeyId())
                        .isEmpty())
                .map(dto -> OneTimePreKey.builder()
                        .device(device)
                        .preKeyId(dto.preKeyId())
                        .publicKey(dto.publicKey())
                        .createdAt(LocalDateTime.now())
                        .build())
                .toList();

        if (!preKeys.isEmpty()) {
            oneTimePreKeyRepository.saveAll(preKeys);
        }
    }

    private void validateOneTimePreKeys(DeviceRegistrationRequest request) {
        Set<Integer> seenPreKeyIds = new HashSet<>();
        for (var dto : request.oneTimePreKeys()) {
            if (dto.preKeyId() == null) {
                throw new IllegalArgumentException("oneTimePreKeys.preKeyId is required");
            }
            if (!seenPreKeyIds.add(dto.preKeyId())) {
                throw new IllegalArgumentException("Duplicate one-time pre-key id: " + dto.preKeyId());
            }
            if (dto.publicKey() == null || dto.publicKey().isBlank()) {
                throw new IllegalArgumentException("oneTimePreKeys.publicKey is required");
            }
        }
    }
}

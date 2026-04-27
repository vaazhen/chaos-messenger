package ru.messenger.chaosmessenger.crypto.device;

import ru.messenger.chaosmessenger.common.exception.*;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationRequest;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationResponse;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKey;
import ru.messenger.chaosmessenger.crypto.prekey.OneTimePreKeyRepository;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKey;
import ru.messenger.chaosmessenger.crypto.prekey.SignedPreKeyRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import java.time.LocalDateTime;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class DeviceService {

    private final UserRepository userRepository;
    private final UserDeviceRepository userDeviceRepository;
    private final SignedPreKeyRepository signedPreKeyRepository;
    private final OneTimePreKeyRepository oneTimePreKeyRepository;

    @Transactional(readOnly = true)
    public Optional<DeviceRegistrationResponse> findCurrentDevice(String username, String deviceId) {
        if (username == null || username.isBlank() || deviceId == null || deviceId.isBlank()) {
            return Optional.empty();
        }

        return userDeviceRepository
                .findByUserUsernameAndDeviceIdAndActiveTrue(username, deviceId)
                .map(device -> DeviceRegistrationResponse.builder()
                        .deviceId(device.getDeviceId())
                        .serverDeviceInternalId(device.getId())
                        .build());
    }

    @Transactional
    public DeviceRegistrationResponse registerDevice(String username, DeviceRegistrationRequest request) {
        if (request.getDeviceId() == null || request.getDeviceId().isBlank()) {
            throw new IllegalArgumentException("deviceId is required");
        }
        if (request.getRegistrationId() == null) {
            throw new IllegalArgumentException("registrationId is required");
        }
        if (request.getIdentityPublicKey() == null || request.getIdentityPublicKey().isBlank()) {
            throw new IllegalArgumentException("identityPublicKey is required");
        }
        if (request.getSignedPreKey() == null) {
            throw new IllegalArgumentException("signedPreKey is required");
        }

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        Optional<UserDevice> existingDevice = userDeviceRepository
                .findByUserUsernameAndDeviceId(username, request.getDeviceId());

        boolean newDevice = existingDevice.isEmpty();
        if (newDevice && (request.getOneTimePreKeys() == null || request.getOneTimePreKeys().isEmpty())) {
            throw new IllegalArgumentException("At least one one-time pre-key is required");
        }

        UserDevice device = existingDevice
                .orElseGet(() -> UserDevice.builder()
                        .user(user)
                        .deviceId(request.getDeviceId())
                        .createdAt(LocalDateTime.now())
                        .active(true)
                        .build());

        device.setDeviceName(request.getDeviceName());
        device.setRegistrationId(request.getRegistrationId());
        device.setIdentityPublicKey(request.getIdentityPublicKey());
        device.setSigningPublicKey(request.getSigningPublicKey());
        device.setLastSeen(LocalDateTime.now());
        device.setActive(true);

        device = userDeviceRepository.save(device);

        upsertSignedPreKey(device, request);
        replaceOneTimePreKeys(device, request);

        return DeviceRegistrationResponse.builder()
                .deviceId(device.getDeviceId())
                .serverDeviceInternalId(device.getId())
                .build();
    }

    private void upsertSignedPreKey(UserDevice device, DeviceRegistrationRequest request) {
        Integer preKeyId  = request.getSignedPreKey().getPreKeyId();
        String publicKey  = request.getSignedPreKey().getPublicKey();
        String signature  = request.getSignedPreKey().getSignature();

        if (publicKey == null || publicKey.isBlank())
            throw new IllegalArgumentException("signedPreKey.publicKey is required");
        if (signature == null || signature.isBlank())
            throw new IllegalArgumentException("signedPreKey.signature is required");
        if ("TEMP_SIGNATURE".equals(signature))
            throw new IllegalArgumentException("signedPreKey.signature must be a real signature");

        // FIX: real ECDSA P-256 verification replacing the former SHA-256 hash stub
        verifySignedPreKeySignature(device.getSigningPublicKey(), publicKey, signature);

        Optional<SignedPreKey> existingOpt = signedPreKeyRepository.findByDeviceIdAndPreKeyId(device.getId(), preKeyId);
        if (existingOpt.isPresent()) {
            SignedPreKey existing = existingOpt.get();
            boolean sameMaterial = publicKey.equals(existing.getPublicKey())
                    && signature.equals(existing.getSignature());
            if (sameMaterial) return;
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
        if (request.getOneTimePreKeys() == null || request.getOneTimePreKeys().isEmpty()) {
            return;
        }

        oneTimePreKeyRepository.deleteByDeviceId(device.getId());
        oneTimePreKeyRepository.flush();

        for (var dto : request.getOneTimePreKeys()) {
            OneTimePreKey oneTimePreKey = OneTimePreKey.builder()
                    .device(device)
                    .preKeyId(dto.getPreKeyId())
                    .publicKey(dto.getPublicKey())
                    .createdAt(LocalDateTime.now())
                    .build();

            oneTimePreKeyRepository.save(oneTimePreKey);
        }
    }
}

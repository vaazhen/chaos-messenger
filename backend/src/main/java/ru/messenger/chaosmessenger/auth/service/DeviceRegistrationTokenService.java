package ru.messenger.chaosmessenger.auth.service;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

/**
 * Issues and validates short-lived device-registration tokens.
 *
 * <p>Flow:
 * <ol>
 *   <li>{@code /api/auth/verify-code} succeeds → returns a {@code deviceRegistrationToken}
 *       (UUID, TTL 60 s, stored in Redis under {@code dev_reg_token:<uuid>} → username).</li>
 *   <li>{@code POST /api/crypto/devices/register} reads the token from the
 *       {@code X-Device-Registration-Token} header, validates it, and consumes it
 *       (one-time use).</li>
 * </ol>
 *
 * <p>This closes the bootstrap gap: device registration no longer requires a
 * fully authenticated JWT, but it still requires proof of a completed OTP flow.
 */
@Service
public class DeviceRegistrationTokenService {

    private static final Duration TTL    = Duration.ofSeconds(60);
    private static final String   PREFIX = "dev_reg_token:";

    private final RedisTemplate<String, String> redisTemplate;

    public DeviceRegistrationTokenService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /** Generate a one-time token bound to {@code username}. */
    public String issue(String username) {
        String token = UUID.randomUUID().toString();
        redisTemplate.opsForValue().set(PREFIX + token, username, TTL);
        return token;
    }

    /**
     * Validate and atomically consume the token.
     *
     * @return the username the token was issued for, or {@code null} if the
     *         token is unknown / already used / expired.
     */
    public String consumeAndGetUsername(String token) {
        if (token == null || token.isBlank()) return null;
        return redisTemplate.opsForValue().getAndDelete(PREFIX + token);
    }
}

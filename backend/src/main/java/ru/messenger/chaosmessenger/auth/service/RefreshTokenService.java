package ru.messenger.chaosmessenger.auth.service;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.UUID;

/**
 * Issues and manages long-lived refresh tokens stored in Redis.
 *
 * <p>Refresh tokens are rotated on each use (one-time), so a stolen token
 * can only be used once before the legitimate user's next refresh invalidates it.
 */
@Service
public class RefreshTokenService {

    private static final Duration REFRESH_TTL = Duration.ofDays(30);
    private static final String   PREFIX      = "refresh_token:";

    private final RedisTemplate<String, String> redisTemplate;

    public RefreshTokenService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /** Issue a new refresh token for {@code username}. */
    public String issue(String username) {
        String token = UUID.randomUUID().toString();
        redisTemplate.opsForValue().set(PREFIX + token, username, REFRESH_TTL);
        return token;
    }

    /**
     * Validate and rotate the token (one-time use).
     *
     * @return username the token belongs to, or {@code null} if invalid/expired.
     */
    public String consumeAndGetUsername(String token) {
        if (token == null || token.isBlank()) return null;
        return redisTemplate.opsForValue().getAndDelete(PREFIX + token);
    }

    /** Explicitly revoke a token (logout). */
    public void revoke(String token) {
        if (token == null || token.isBlank()) return;
        redisTemplate.delete(PREFIX + token);
    }
}

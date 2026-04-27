package ru.messenger.chaosmessenger.auth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.UUID;

/**
 * Issues and consumes short-lived setup tokens used in two-phase phone registration.
 *
 * Flow:
 *   1. verifyCode (new user) → issue(phone) → return setupToken to client
 *   2. client fills profile → completeSetup(setupToken, ...) → consumePhone(setupToken)
 *
 * Token TTL: 10 minutes. One-time use (consumed on first call to consumePhone).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SetupTokenService {

    private static final String   PREFIX = "setup:token:";
    private static final Duration TTL    = Duration.ofMinutes(10);

    private final RedisTemplate<String, String> redisTemplate;

    /** Issue a one-time setup token bound to a verified phone number. */
    public String issue(String phone) {
        String token = UUID.randomUUID().toString();
        redisTemplate.opsForValue().set(PREFIX + token, phone, TTL);
        log.debug("[SetupToken] issued for phone={}", phone);
        return token;
    }

    /**
     * Consume a setup token — returns the phone it was bound to,
     * or {@code null} if the token is invalid or already expired.
     * The token is deleted on first use (one-time).
     */
    public String consumePhone(String token) {
        if (token == null || token.isBlank()) return null;
        String key   = PREFIX + token;
        String phone = redisTemplate.opsForValue().get(key);
        if (phone != null) {
            redisTemplate.delete(key);
            log.debug("[SetupToken] consumed for phone={}", phone);
        } else {
            log.warn("[SetupToken] invalid or expired token");
        }
        return phone;
    }
}
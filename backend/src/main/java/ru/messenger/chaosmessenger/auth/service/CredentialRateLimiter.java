package ru.messenger.chaosmessenger.auth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import ru.messenger.chaosmessenger.common.exception.RateLimitException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class CredentialRateLimiter {

    private static final int LOGIN_LIMIT = 10;
    private static final Duration LOGIN_WINDOW = Duration.ofMinutes(15);
    private static final int REGISTER_LIMIT = 5;
    private static final Duration REGISTER_WINDOW = Duration.ofHours(1);
    private static final int IP_LIMIT = 40;
    private static final Duration IP_WINDOW = Duration.ofMinutes(15);
    private static final int PREKEY_USER_LIMIT = 20;
    private static final int PREKEY_TARGET_LIMIT = 4;
    private static final Duration PREKEY_WINDOW = Duration.ofMinutes(15);
    private static final long INFRA_RETRY_AFTER_SECONDS = 60;

    private static final DefaultRedisScript<Long> INCREMENT_WITH_TTL = new DefaultRedisScript<>("""
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
                redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return current
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public void checkAndIncrement(String normalizedEmail) {
        enforce(
                "auth:login:rate:",
                normalizedEmail,
                LOGIN_LIMIT,
                LOGIN_WINDOW,
                "Too many login attempts. Try again in 15 minutes."
        );
    }

    public void checkRegister(String normalizedEmail) {
        enforce(
                "auth:register:rate:",
                normalizedEmail,
                REGISTER_LIMIT,
                REGISTER_WINDOW,
                "Too many registration attempts. Try again later."
        );
    }

    public void checkPrekeyReserve(String username, String targetDeviceId) {
        checkUserAction(username, "prekey");
        String identity = (username == null || username.isBlank()) ? "unknown" : username.trim();
        String target = (targetDeviceId == null || targetDeviceId.isBlank()) ? "unknown" : targetDeviceId.trim();
        enforce(
                "auth:user:prekey-target:",
                identity + ":" + target,
                PREKEY_TARGET_LIMIT,
                PREKEY_WINDOW,
                "Too many pre-key reservations for this device. Try again later."
        );
    }

    public void checkUserAction(String username, String action) {
        String identity = (username == null || username.isBlank()) ? "unknown" : username.trim();
        String safeAction = action != null && action.matches("[a-z]+") ? action : "other";
        int limit = "prekey".equals(safeAction) ? PREKEY_USER_LIMIT : 80;
        Duration window = "prekey".equals(safeAction) ? PREKEY_WINDOW : Duration.ofMinutes(15);
        enforce(
                "auth:user:" + safeAction + ":",
                identity,
                limit,
                window,
                "Too many requests. Try again later."
        );
    }

    public void checkLookup(String clientIp) {
        enforce(
                "auth:ip:lookup:",
                (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim(),
                20,
                IP_WINDOW,
                "Too many lookup requests. Try again later."
        );
    }

    public void checkVerify(String clientIp) {
        enforce(
                "auth:ip:verify:",
                (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim(),
                30,
                IP_WINDOW,
                "Too many verification attempts. Try again later."
        );
    }

    public void checkIp(String clientIp, String action) {
        String identity = (clientIp == null || clientIp.isBlank()) ? "unknown" : clientIp.trim();
        String safeAction = action != null && action.matches("[a-z]+") ? action : "other";
        enforce(
                "auth:ip:" + safeAction + ":",
                identity,
                IP_LIMIT,
                IP_WINDOW,
                "Too many requests. Try again later."
        );
    }

    public void reset(String normalizedEmail) {
        try {
            redisTemplate.delete(key("auth:login:rate:", normalizedEmail));
        } catch (Exception e) {
            log.warn("Unable to reset credential rate limit: {}", e.getMessage());
        }
    }

    private void enforce(String prefix, String identity, int limit, Duration window, String message) {
        String redisKey = key(prefix, identity);
        Long count;
        try {
            count = redisTemplate.execute(
                    INCREMENT_WITH_TTL,
                    List.of(redisKey),
                    String.valueOf(window.toSeconds())
            );
        } catch (Exception e) {
            log.warn("Credential rate limiter unavailable: {}", e.getMessage());
            throw new RateLimitException(
                    "Authentication is temporarily unavailable. Please try again later.",
                    INFRA_RETRY_AFTER_SECONDS
            );
        }
        if (count == null) {
            throw new RateLimitException(
                    "Authentication is temporarily unavailable. Please try again later.",
                    INFRA_RETRY_AFTER_SECONDS
            );
        }
        if (count > limit) {
            throw new RateLimitException(message, window.toSeconds());
        }
    }

    private String key(String prefix, String identity) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(identity.getBytes(StandardCharsets.UTF_8));
            return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}

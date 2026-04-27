package ru.messenger.chaosmessenger.auth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import ru.messenger.chaosmessenger.common.exception.RateLimitException;

import java.time.Duration;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class SmsRateLimiter {

    private static final int SHORT_LIMIT = 3;
    private static final int SHORT_WINDOW_MINUTES = 10;
    private static final int DAY_LIMIT = 10;

    private static final DefaultRedisScript<Long> INCREMENT_WITH_TTL_SCRIPT = new DefaultRedisScript<>("""
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
                redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return current
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public void checkAndIncrement(String phone) {
        checkLimit(
                "sms:rate:short:" + phone,
                SHORT_LIMIT,
                Duration.ofMinutes(SHORT_WINDOW_MINUTES),
                "Too many SMS codes. Please wait " + SHORT_WINDOW_MINUTES + " minutes.",
                (long) SHORT_WINDOW_MINUTES * 60
        );
        checkLimit(
                "sms:rate:day:" + phone,
                DAY_LIMIT,
                Duration.ofHours(24),
                "Daily SMS code limit exceeded. Try again tomorrow.",
                24 * 60 * 60L
        );
    }

    private void checkLimit(String key, int limit, Duration ttl, String message, long retryAfterSeconds) {
        Long count;
        try {
            count = redisTemplate.execute(INCREMENT_WITH_TTL_SCRIPT, List.of(key), String.valueOf(ttl.toSeconds()));
        } catch (Exception e) {
            log.warn("Redis unavailable during rate-limit check for key {}: {}", key, e.getMessage());
            return;
        }
        if (count == null) {
            log.warn("Redis returned null during rate-limit check for key {}", key);
            return;
        }
        if (count > limit) {
            log.warn("Rate limit exceeded: key={}, count={}, limit={}", key, count, limit);
            throw new RateLimitException(message, retryAfterSeconds);
        }
    }
}

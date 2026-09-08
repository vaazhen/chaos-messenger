package ru.messenger.chaosmessenger.auth;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import ru.messenger.chaosmessenger.auth.service.CredentialRateLimiter;
import ru.messenger.chaosmessenger.common.exception.RateLimitException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CredentialRateLimiterTest {

    @Test
    void blocksAfterConfiguredWindowLimitWithoutPuttingEmailInRedisKey() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(11L);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        assertThatThrownBy(() -> limiter.checkAndIncrement("alice@example.com"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("Too many login attempts");
    }

    @Test
    void registerBlocksAfterConfiguredWindowWithoutPuttingEmailInRedisKey() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(6L);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        assertThatThrownBy(() -> limiter.checkRegister("alice@example.com"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("registration");
    }

    @Test
    void ipLimitDoesNotPutRawAddressInRedisKey() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(41L);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        assertThatThrownBy(() -> limiter.checkIp("203.0.113.9", "register"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("Too many requests");
    }

    @Test
    void lookupLimitIsTighterThanGenericIpLimit() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(21L);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        assertThatThrownBy(() -> limiter.checkLookup("203.0.113.9"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("lookup");
    }

    @Test
    void resetDeletesOnlyHashedRateKey() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        limiter.reset("alice@example.com");

        verify(redis).delete(org.mockito.ArgumentMatchers.<String>argThat(
                key -> key.startsWith("auth:login:rate:") && !key.contains("alice@example.com")
        ));
    }

    @Test
    void prekeyTargetLimitIsTighterThanGenericUserAction() {
        RedisTemplate<String, String> redis = mock(RedisTemplate.class);
        when(redis.execute(any(), anyList(), anyString())).thenReturn(5L);
        CredentialRateLimiter limiter = new CredentialRateLimiter(redis);

        assertThatThrownBy(() -> limiter.checkPrekeyReserve("alice", "device-bob"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("pre-key");
    }
}

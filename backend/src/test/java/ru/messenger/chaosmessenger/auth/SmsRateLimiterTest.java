package ru.messenger.chaosmessenger.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import ru.messenger.chaosmessenger.auth.service.SmsRateLimiter;
import ru.messenger.chaosmessenger.common.exception.RateLimitException;


import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("SmsRateLimiter")
class SmsRateLimiterTest {

    @Mock
    RedisTemplate<String, String> redisTemplate;

    SmsRateLimiter rateLimiter;

    @BeforeEach
    void setUp() {
        rateLimiter = new SmsRateLimiter(redisTemplate);
    }

    @Test
    @DisplayName("first request is allowed")
    void firstRequestPasses() {
        mockRedisCounts(1L, 1L);

        assertThatCode(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("3 requests are allowed as the short-window limit")
    void thirdRequestPasses() {
        mockRedisCounts(3L, 3L);

        assertThatCode(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("4th request within 10 minutes throws RateLimitException")
    void fourthRequestInShortWindowThrows() {
        mockRedisCounts(4L);

        assertThatThrownBy(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("minutes");
    }

    @Test
    @DisplayName("daily limit exceeded throws RateLimitException")
    void dailyLimitThrows() {
        mockRedisCounts(1L, 11L);

        assertThatThrownBy(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .isInstanceOf(RateLimitException.class)
                .hasMessageContaining("tomorrow");
    }

    @Test
    @DisplayName("when Redis is unavailable, allow without blocking")
    void redisUnavailableAllowsRequest() {
        mockRedisCounts((Long) null);

        assertThatCode(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("retryAfterSeconds is populated correctly")
    void retryAfterIsSet() {
        mockRedisCounts(4L);

        assertThatThrownBy(() -> rateLimiter.checkAndIncrement("+79001234567"))
                .isInstanceOf(RateLimitException.class)
                .satisfies(ex -> {
                    long retryAfter = ((RateLimitException) ex).getRetryAfterSeconds();
                    assert retryAfter > 0 : "retryAfterSeconds must be positive";
                });
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void mockRedisCounts(Long... counts) {
        when(redisTemplate.execute(any(DefaultRedisScript.class), anyList(), anyString()))
                .thenReturn(counts[0], java.util.Arrays.copyOfRange(counts, 1, counts.length));
    }
}

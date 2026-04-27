package ru.messenger.chaosmessenger.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ru.messenger.chaosmessenger.auth.service.RefreshTokenService;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RefreshTokenServiceTest {

    private RedisTemplate<String, String> redisTemplate;
    private ValueOperations<String, String> valueOps;
    private RefreshTokenService service;

    @BeforeEach
    void setup() {
        redisTemplate = Mockito.mock(RedisTemplate.class);
        valueOps      = Mockito.mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        service = new RefreshTokenService(redisTemplate);
    }

    @Test
    void issue_storesTokenWith30DayTTL() {
        String token = service.issue("alice");

        assertThat(token).isNotBlank();
        verify(valueOps).set(contains(token), eq("alice"), eq(Duration.ofDays(30)));
    }

    @Test
    void consumeAndGetUsername_consumesTokenAtomically() {
        String token = "refresh-uuid";
        when(valueOps.getAndDelete("refresh_token:" + token)).thenReturn("alice");

        String result = service.consumeAndGetUsername(token);

        assertThat(result).isEqualTo("alice");
        verify(valueOps).getAndDelete("refresh_token:" + token);
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void consumeAndGetUsername_returnsNullForExpiredToken() {
        when(valueOps.getAndDelete(anyString())).thenReturn(null);
        assertThat(service.consumeAndGetUsername("expired")).isNull();
    }

    @Test
    void revoke_deletesKey() {
        service.revoke("some-token");
        verify(redisTemplate).delete("refresh_token:some-token");
    }

    @Test
    void revoke_doesNothingForNull() {
        service.revoke(null);
        verifyNoInteractions(redisTemplate);
    }
}

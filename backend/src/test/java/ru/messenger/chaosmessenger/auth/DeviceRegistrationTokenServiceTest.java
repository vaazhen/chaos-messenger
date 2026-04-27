package ru.messenger.chaosmessenger.auth;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DeviceRegistrationTokenServiceTest {

    private RedisTemplate<String, String> redisTemplate;
    private ValueOperations<String, String> valueOps;
    private DeviceRegistrationTokenService service;

    @BeforeEach
    void setup() {
        redisTemplate = Mockito.mock(RedisTemplate.class);
        valueOps      = Mockito.mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        service = new DeviceRegistrationTokenService(redisTemplate);
    }

    @Test
    void issue_storesTokenInRedisWithTTL() {
        String token = service.issue("alice");

        assertThat(token).isNotBlank();
        verify(valueOps).set(contains(token), eq("alice"), eq(Duration.ofSeconds(60)));
    }

    @Test
    void consumeAndGetUsername_consumesTokenAtomically() {
        String token = "test-uuid-token";
        when(valueOps.getAndDelete("dev_reg_token:" + token)).thenReturn("alice");

        String result = service.consumeAndGetUsername(token);

        assertThat(result).isEqualTo("alice");
        verify(valueOps).getAndDelete("dev_reg_token:" + token);
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void consumeAndGetUsername_returnsNullForUnknownToken() {
        when(valueOps.getAndDelete(anyString())).thenReturn(null);

        String result = service.consumeAndGetUsername("unknown-token");

        assertThat(result).isNull();
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void consumeAndGetUsername_returnsNullForNullInput() {
        String result = service.consumeAndGetUsername(null);
        assertThat(result).isNull();
        verifyNoInteractions(redisTemplate);
    }

    @Test
    void consumeAndGetUsername_isOneTimeUse() {
        String token = service.issue("bob");
        when(valueOps.getAndDelete(contains(token))).thenReturn("bob").thenReturn(null);

        String first  = service.consumeAndGetUsername(token);
        String second = service.consumeAndGetUsername(token);

        assertThat(first).isEqualTo("bob");
        assertThat(second).isNull();
    }
}

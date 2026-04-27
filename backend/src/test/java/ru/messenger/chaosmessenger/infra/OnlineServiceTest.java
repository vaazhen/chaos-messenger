package ru.messenger.chaosmessenger.infra;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import ru.messenger.chaosmessenger.infra.presence.OnlineService;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("OnlineService")
class OnlineServiceTest {

    @Mock RedisTemplate<String, String> redisTemplate;
    @Mock ValueOperations<String, String> valueOps;

    OnlineService onlineService;

    @BeforeEach
    void setUp() {
        // lenient() because isOnline tests only use hasKey(),
        // without calling opsForValue(); without lenient Mockito throws UnnecessaryStubbingException
        lenient().when(redisTemplate.opsForValue()).thenReturn(valueOps);
        onlineService = new OnlineService(redisTemplate);
    }

    @Test
    @DisplayName("setOnline writes a TTL key and updates last seen")
    void setOnlineWritesTtlKey() {
        onlineService.setOnline("alice");

        verify(valueOps).set(eq("presence:alice"), eq("1"), any(java.time.Duration.class));
        verify(valueOps).set(eq("lastseen:alice"), anyString());
    }

    @Test
    @DisplayName("setOffline deletes the presence key and updates last seen")
    void setOfflineDeletesKey() {
        onlineService.setOffline("alice");

        verify(redisTemplate).delete("presence:alice");
        verify(valueOps).set(eq("lastseen:alice"), anyString());
    }

    @Test
    @DisplayName("isOnline returns true when the key exists in Redis")
    void isOnlineReturnsTrueWhenKeyExists() {
        when(redisTemplate.hasKey("presence:alice")).thenReturn(true);
        assertThat(onlineService.isOnline("alice")).isTrue();
    }

    @Test
    @DisplayName("isOnline returns false when the key does not exist")
    void isOnlineReturnsFalseWhenKeyAbsent() {
        when(redisTemplate.hasKey("presence:alice")).thenReturn(false);
        assertThat(onlineService.isOnline("alice")).isFalse();
    }

    @Test
    @DisplayName("isOnline returns false for null from Redis")
    void isOnlineReturnsFalseOnNull() {
        when(redisTemplate.hasKey("presence:alice")).thenReturn(null);
        assertThat(onlineService.isOnline("alice")).isFalse();
    }

    @Test
    @DisplayName("getLastSeen parses a date from Redis")
    void getLastSeenParsesDate() {
        LocalDateTime now = LocalDateTime.now().withNano(0);
        when(valueOps.get("lastseen:alice")).thenReturn(now.toString());

        LocalDateTime result = onlineService.getLastSeen("alice");
        assertThat(result).isEqualTo(now);
    }

    @Test
    @DisplayName("getLastSeen returns default date when the key does not exist")
    void getLastSeenReturnsDefaultWhenMissing() {
        when(valueOps.get("lastseen:alice")).thenReturn(null);

        LocalDateTime result = onlineService.getLastSeen("alice");
        assertThat(result).isBefore(LocalDateTime.now());
    }

    @Test
    @DisplayName("getLastSeen does not fail for an invalid Redis value")
    void getLastSeenHandlesCorruptedValue() {
        when(valueOps.get("lastseen:alice")).thenReturn("not-a-date");

        assertThat(onlineService.getLastSeen("alice")).isNotNull();
    }
}

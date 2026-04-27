package ru.messenger.chaosmessenger.infra.presence;

import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class OnlineService {

    private final org.springframework.data.redis.core.RedisTemplate<String, String> redisTemplate;

    public OnlineService(org.springframework.data.redis.core.RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    public void setOnline(String username) {
        String key = "presence:" + username;
        redisTemplate.opsForValue().set(key, "1", java.time.Duration.ofSeconds(30));
        redisTemplate.opsForValue().set("lastseen:" + username, java.time.LocalDateTime.now().toString());
    }

    public void setOffline(String username) {
        String key = "presence:" + username;
        redisTemplate.delete(key);
        redisTemplate.opsForValue().set("lastseen:" + username, java.time.LocalDateTime.now().toString());
    }

    public boolean isOnline(String username) {
        String key = "presence:" + username;
        Boolean has = redisTemplate.hasKey(key);
        return Boolean.TRUE.equals(has);
    }

    public java.time.LocalDateTime getLastSeen(String username) {
        String s = redisTemplate.opsForValue().get("lastseen:" + username);
        if (s == null) return java.time.LocalDateTime.now().minusDays(1);
        try {
            return java.time.LocalDateTime.parse(s);
        } catch (Exception ex) {
            return java.time.LocalDateTime.now().minusDays(1);
        }
    }
}
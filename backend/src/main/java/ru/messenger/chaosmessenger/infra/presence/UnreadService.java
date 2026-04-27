package ru.messenger.chaosmessenger.infra.presence;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class UnreadService {

    private final RedisTemplate<String, String> redisTemplate;

    public UnreadService(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    private String key(Long userId, Long chatId) {
        return "unread:" + userId + ":" + chatId;
    }

    public void increment(Long userId, Long chatId) {
        redisTemplate.opsForValue().increment(key(userId, chatId));
    }

    public void reset(Long userId, Long chatId) {
        redisTemplate.delete(key(userId, chatId));
    }

    public long get(Long userId, Long chatId) {
        String value = redisTemplate.opsForValue().get(key(userId, chatId));
        return value == null ? 0 : Long.parseLong(value);
    }
}
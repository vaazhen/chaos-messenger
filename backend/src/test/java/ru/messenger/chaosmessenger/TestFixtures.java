package ru.messenger.chaosmessenger;

import ru.messenger.chaosmessenger.chat.domain.Chat;
import ru.messenger.chaosmessenger.chat.domain.ChatParticipant;
import ru.messenger.chaosmessenger.chat.domain.Message;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.domain.UserStatus;

import java.time.LocalDateTime;

/**
 * Static factory helpers for building test entities.
 * Keeps test classes short and readable.
 */
public final class TestFixtures {

    private TestFixtures() {}

    public static User user(Long id, String username) {
        User u = new User();
        u.setId(id);
        u.setUsername(username);
        u.setEmail(username + "@test.com");
        u.setPasswordHash("hash");
        u.setStatus(UserStatus.ACTIVE);
        u.setCreatedAt(LocalDateTime.now());
        return u;
    }

    public static Chat directChat(Long id) {
        Chat c = new Chat();
        c.setId(id);
        c.setType("DIRECT");
        c.setCreatedAt(LocalDateTime.now());
        return c;
    }

    public static Chat groupChat(Long id, String name) {
        Chat c = new Chat();
        c.setId(id);
        c.setType("GROUP");
        c.setName(name);
        c.setCreatedAt(LocalDateTime.now());
        return c;
    }

    public static ChatParticipant participant(Long chatId, Long userId) {
        return new ChatParticipant(chatId, userId);
    }

    public static Message sentMessage(Long id, Long chatId, Long senderId, String deviceId) {
        Message m = new Message();
        m.setId(id);
        m.setChatId(chatId);
        m.setSenderId(senderId);
        m.setSenderDeviceId(deviceId);
        m.setClientMessageId("client-" + id);
        m.setContent("[encrypted]");
        m.setStatus(Message.MessageStatus.SENT);
        m.setVersion(1);
        m.setCreatedAt(LocalDateTime.now());
        return m;
    }

    public static UserDevice device(Long dbId, Long userId, String deviceId) {
        User owner = new User();
        owner.setId(userId);
        UserDevice d = new UserDevice();
        d.setId(dbId);
        d.setUser(owner);
        d.setDeviceId(deviceId);
        d.setRegistrationId(1);
        d.setActive(true);
        d.setCreatedAt(java.time.LocalDateTime.now());
        return d;
    }
}

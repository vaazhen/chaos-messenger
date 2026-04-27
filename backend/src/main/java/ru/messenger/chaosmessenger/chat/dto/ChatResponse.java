package ru.messenger.chaosmessenger.chat.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

@Data
@AllArgsConstructor
public class ChatResponse {
    private Long chatId;
    private String type;
    /** Display name: for GROUP — the group name; for DIRECT — null (use otherUsername) */
    private String name;
    private String lastMessage;
    private Long lastMessageId;
    private LocalDateTime lastMessageAt;
    /** Who sent the last message (for "You: ..." vs "Alice: ..." prefix in chat list) */
    private Long lastMessageSenderId;
    private List<Long> participants;
    private Long otherUserId;
    private String otherUsername;
    private String otherFirstName;
    private String otherLastName;
    private String otherAvatarUrl;
    private long unreadCount;
    private boolean online;
    private LocalDateTime lastSeen;
}

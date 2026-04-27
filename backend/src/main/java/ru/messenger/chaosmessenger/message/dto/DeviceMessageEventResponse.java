package ru.messenger.chaosmessenger.message.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

@Data
@AllArgsConstructor
public class DeviceMessageEventResponse {
    private String type;
    private Long messageId;
    private Long chatId;
    private Long senderId;
    private String senderDeviceId;
    private String clientMessageId;
    private Integer version;
    private LocalDateTime createdAt;
    private LocalDateTime editedAt;
    private LocalDateTime deletedAt;
    private String status;
    private TimelineEnvelopeDto envelope;
    private Map<String, Long> reactions;
    private Set<String> myReactions;
}
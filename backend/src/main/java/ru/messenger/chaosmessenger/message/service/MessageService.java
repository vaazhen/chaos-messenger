package ru.messenger.chaosmessenger.message.service;


import ru.messenger.chaosmessenger.user.service.UserIdentityService;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.messenger.chaosmessenger.chat.domain.ChatParticipant;
import ru.messenger.chaosmessenger.chat.domain.Message;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.common.TransactionUtils;
import ru.messenger.chaosmessenger.common.exception.AuthException;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.common.exception.MessageException;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.device.UserDeviceRepository;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedEditMessageRequestV2;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedMessageEnvelopeInput;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedSendMessageRequestV2;
import ru.messenger.chaosmessenger.infra.presence.UnreadService;
import ru.messenger.chaosmessenger.message.domain.MessageEnvelope;
import ru.messenger.chaosmessenger.message.domain.MessageEvent;
import ru.messenger.chaosmessenger.message.domain.MessageReaction;
import ru.messenger.chaosmessenger.message.domain.MessageReceipt;
import ru.messenger.chaosmessenger.message.dto.DeviceMessageEventResponse;
import ru.messenger.chaosmessenger.message.dto.MessageTimelineItemResponse;
import ru.messenger.chaosmessenger.message.dto.TimelineEnvelopeDto;
import ru.messenger.chaosmessenger.message.repository.MessageEnvelopeRepository;
import ru.messenger.chaosmessenger.message.repository.MessageEventRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReactionRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReceiptRepository;
import ru.messenger.chaosmessenger.message.repository.MessageRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class MessageService {

    private final MessageRepository messageRepository;
    private final MessageEnvelopeRepository messageEnvelopeRepository;
    private final MessageEventRepository messageEventRepository;
    private final MessageReceiptRepository messageReceiptRepository;
    private final MessageReactionRepository messageReactionRepository;
    private final ChatParticipantRepository participantRepository;
    private final UserRepository userRepository;
    private final UserIdentityService userIdentityService;
    private final UserDeviceRepository userDeviceRepository;
    private final CurrentDeviceService currentDeviceService;
    private final UnreadService unreadService;
    private final SimpMessagingTemplate messagingTemplate;
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;

    @Transactional
    public DeviceMessageEventResponse sendEncryptedMessageV2(String username, EncryptedSendMessageRequestV2 request) {
        User sender = requireUser(username);
        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();
        validateBasicSendRequest(sender, currentDevice, request);

        Optional<Message> existing = messageRepository.findByClientMessageId(request.getClientMessageId());
        if (existing.isPresent()) {
            Message existingMessage = existing.get();
            boolean sameMessage = Objects.equals(existingMessage.getChatId(), request.getChatId())
                    && Objects.equals(existingMessage.getSenderId(), sender.getId())
                    && Objects.equals(existingMessage.getSenderDeviceId(), currentDevice.getDeviceId());
            if (!sameMessage) {
                throw new MessageException("clientMessageId already belongs to another message");
            }

            MessageEnvelope currentEnvelope = messageEnvelopeRepository
                    .findByMessageIdAndTargetDeviceId(existingMessage.getId(), currentDevice.getDeviceId())
                    .orElse(null);
            return toDeviceEvent("MESSAGE_CREATED", existingMessage, currentEnvelope, sender.getId());
        }

        validateEnvelopeTargets(request.getChatId(), request.getEnvelopes());

        Message message = new Message();
        message.setChatId(request.getChatId());
        message.setSenderId(sender.getId());
        message.setSenderDeviceId(currentDevice.getDeviceId());
        message.setClientMessageId(request.getClientMessageId());
        message.setContent("[encrypted]");
        message.setCreatedAt(LocalDateTime.now());
        message.setStatus(Message.MessageStatus.SENT);
        message = messageRepository.save(message);

        incrementCounter("messages_sent_total");

        Map<String, MessageEnvelope> byDevice = persistEnvelopes(message, sender, request.getEnvelopes());
        incrementUnreadForOthers(request.getChatId(), sender.getId());

        final Message msgFinal = message;
        final Map<String, MessageEnvelope> byDeviceFinal = byDevice;
        TransactionUtils.afterCommit(() -> {
            fanoutCreatedEvent(msgFinal, byDeviceFinal);
            notifyChatListUpdated(msgFinal.getChatId(), "message_created");
        });

        return toDeviceEvent("MESSAGE_CREATED", message, byDevice.get(currentDevice.getDeviceId()), sender.getId());
    }

    @Transactional
    public DeviceMessageEventResponse editEncryptedMessageV2(String username, Long messageId, EncryptedEditMessageRequestV2 request) {
        User sender = requireUser(username);
        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();
        Message message = messageRepository.findById(messageId)
                .orElseThrow(() -> new MessageException("Message not found"));

        requireParticipant(message.getChatId(), sender.getId());

        if (!Objects.equals(message.getSenderId(), sender.getId())) {
            throw new MessageException("You can only edit your own messages");
        }
        if (message.getDeletedAt() != null) {
            throw new MessageException("Deleted messages cannot be edited");
        }
        if (request.getSenderDeviceId() == null || !request.getSenderDeviceId().equals(currentDevice.getDeviceId())) {
            throw new MessageException("senderDeviceId must match current X-Device-Id");
        }

        validateEnvelopeTargets(message.getChatId(), request.getEnvelopes());

        message.setVersion(message.getVersion() + 1);
        message.setEditedAt(LocalDateTime.now());
        messageRepository.save(message);
        incrementCounter("messages_edited_total");

        messageEnvelopeRepository.deleteByMessageId(messageId);
        messageEnvelopeRepository.flush();

        Map<String, MessageEnvelope> byDevice = persistEnvelopes(message, sender, request.getEnvelopes());
        saveMessageEvent(message, sender.getId(), "EDIT", Map.of("version", message.getVersion()));

        final Message msgEditFinal = message;
        final Map<String, MessageEnvelope> byDeviceEditFinal = byDevice;
        TransactionUtils.afterCommit(() -> {
            fanoutEditedEvent(msgEditFinal, byDeviceEditFinal);
            notifyChatListUpdated(msgEditFinal.getChatId(), "message_edited");
        });

        return toDeviceEvent("MESSAGE_EDITED", message, byDevice.get(currentDevice.getDeviceId()), sender.getId());
    }

    @Transactional(readOnly = true)
    public List<MessageTimelineItemResponse> getChatTimeline(String username, Long chatId, Long beforeMessageId, int limit) {
        User user = requireUser(username);
        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();
        requireParticipant(chatId, user.getId());

        PageRequest pageable = PageRequest.of(0, Math.max(1, Math.min(limit, 200)));
        List<Message> messages = messageRepository.findByChatIdBefore(chatId, beforeMessageId, pageable);
        Collections.reverse(messages);

        List<Long> messageIds = messages.stream().map(Message::getId).toList();

        List<MessageEnvelope> envelopes = messageIds.isEmpty()
                ? List.of()
                : messageEnvelopeRepository.findByMessageIdInAndTargetDeviceId(messageIds, currentDevice.getDeviceId());

        Map<Long, MessageEnvelope> envelopeByMessageId = envelopes.stream()
                .collect(Collectors.toMap(MessageEnvelope::getMessageId, Function.identity()));

        List<MessageTimelineItemResponse> result = new ArrayList<>();
        for (Message message : messages) {
            result.add(toTimelineItem(message, envelopeByMessageId.get(message.getId()), user.getId()));
        }
        return result;
    }

    @Transactional
    public void deleteMessage(String username, Long messageId) {
        User user = requireUser(username);
        Message message = messageRepository.findById(messageId)
                .orElseThrow(() -> new MessageException("Message not found"));

        requireParticipant(message.getChatId(), user.getId());

        if (!Objects.equals(message.getSenderId(), user.getId())) {
            throw new MessageException("You can only delete your own messages");
        }
        if (message.getDeletedAt() != null) {
            return;
        }

        message.setDeletedAt(LocalDateTime.now());
        messageRepository.save(message);
        incrementCounter("messages_deleted_total");
        saveMessageEvent(message, user.getId(), "DELETE", Map.of());

        final Message msgDelFinal = message;
        TransactionUtils.afterCommit(() -> {
            fanoutDeleteEvent(msgDelFinal);
            notifyChatListUpdated(msgDelFinal.getChatId(), "message_deleted");
        });
    }

    @Transactional
    public void markChatAsRead(String username, Long chatId) {
        User user = requireUser(username);
        UserDevice currentDevice = currentDeviceOrNull();
        String deviceId = deviceIdOrFallback(currentDevice);

        requireParticipant(chatId, user.getId());
        unreadService.reset(user.getId(), chatId);

        List<Message> messages = messageRepository.findByChatIdAndSenderIdNot(chatId, user.getId());

        for (Message message : messages) {
            markReceiptRead(message, user.getId(), deviceId);
            updateAggregateStatus(message);
            sendStatusToSenderDevices(message, message.getStatus().name());
        }

        incrementCounter("messages_read_total", messages.size());
        notifyChatListUpdated(chatId, "chat_read");
    }

    @Transactional
    public void markChatAsDelivered(String username, Long chatId) {
        User user = requireUser(username);
        UserDevice currentDevice = currentDeviceOrNull();
        String deviceId = deviceIdOrFallback(currentDevice);

        requireParticipant(chatId, user.getId());

        List<Message> messages = messageRepository.findByChatIdAndSenderIdNot(chatId, user.getId());

        for (Message message : messages) {
            if (message.getStatus() == Message.MessageStatus.READ) {
                continue;
            }
            markReceiptDelivered(message, user.getId(), deviceId);
            updateAggregateStatus(message);
            sendStatusToSenderDevices(message, message.getStatus().name());
        }

        incrementCounter("messages_delivered_total", messages.size());
        notifyChatListUpdated(chatId, "chat_delivered");
    }

    @Transactional
    public void updateMessageStatus(String username, Long messageId, String status) {
        User user = requireUser(username);
        UserDevice currentDevice = currentDeviceOrNull();
        String deviceId = deviceIdOrFallback(currentDevice);

        Message message = messageRepository.findById(messageId)
                .orElseThrow(() -> new MessageException("Message not found"));

        requireParticipant(message.getChatId(), user.getId());

        if (message.getSenderId().equals(user.getId())) {
            return;
        }

        Message.MessageStatus newStatus = Message.MessageStatus.valueOf(status);

        switch (newStatus) {
            case DELIVERED -> markReceiptDelivered(message, user.getId(), deviceId);
            case READ -> markReceiptRead(message, user.getId(), deviceId);
            case SENT -> { return; }
        }

        updateAggregateStatus(message);
        sendStatusToSenderDevices(message, message.getStatus().name());
    }

    @Transactional
    public ReactionEvent toggleReaction(String username, Long messageId, String emoji) {
        User user = requireUser(username);
        UserDevice currentDevice = currentDeviceService.requireCurrentDevice();

        Message message = messageRepository.findById(messageId)
                .orElseThrow(() -> new MessageException("Message not found"));

        requireParticipant(message.getChatId(), user.getId());

        if (message.getDeletedAt() != null) {
            throw new MessageException("Cannot react to deleted message");
        }

        String cleanEmoji = normalizeEmoji(emoji);

        Optional<MessageReaction> existing =
                messageReactionRepository.findByMessageIdAndUserIdAndEmoji(messageId, user.getId(), cleanEmoji);

        boolean active;

        if (existing.isPresent()) {
            messageReactionRepository.delete(existing.get());
            active = false;
        } else {
            MessageReaction reaction = new MessageReaction();
            reaction.setMessageId(messageId);
            reaction.setChatId(message.getChatId());
            reaction.setUserId(user.getId());
            reaction.setEmoji(cleanEmoji);
            reaction.setCreatedAt(LocalDateTime.now());
            messageReactionRepository.save(reaction);
            active = true;
        }

        Map<String, Long> summary = reactionSummary(messageId);

        ReactionEvent event = new ReactionEvent(
                "MESSAGE_REACTION",
                messageId,
                message.getChatId(),
                user.getId(),
                currentDevice.getDeviceId(),
                cleanEmoji,
                active,
                summary,
                System.currentTimeMillis()
        );

        saveMessageEvent(message, user.getId(), "REACTION", Map.of("emoji", cleanEmoji, "active", active));

        TransactionUtils.afterCommit(() -> fanoutReactionEvent(message.getChatId(), event));

        return event;
    }

    private void updateAggregateStatus(Message message) {
        Message.MessageStatus aggregate = aggregateStatus(message);
        if (message.getStatus() != aggregate) {
            message.setStatus(aggregate);
            messageRepository.save(message);
        }
    }

    private boolean markReceiptDelivered(Message message, Long userId, String deviceId) {
        messageReceiptRepository.upsertDelivered(
                message.getId(),
                message.getChatId(),
                userId,
                deviceId,
                LocalDateTime.now()
        );
        return true;
    }

    private boolean markReceiptRead(Message message, Long userId, String deviceId) {
        messageReceiptRepository.upsertRead(
                message.getId(),
                message.getChatId(),
                userId,
                deviceId,
                LocalDateTime.now()
        );
        return true;
    }

    private MessageReceipt getOrCreateReceipt(Message message, Long userId, String deviceId) {
        return messageReceiptRepository.findByMessageIdAndUserIdAndDeviceId(message.getId(), userId, deviceId)
                .orElseGet(() -> {
                    LocalDateTime now = LocalDateTime.now();
                    MessageReceipt receipt = new MessageReceipt();
                    receipt.setMessageId(message.getId());
                    receipt.setChatId(message.getChatId());
                    receipt.setUserId(userId);
                    receipt.setDeviceId(deviceId);
                    receipt.setCreatedAt(now);
                    receipt.setUpdatedAt(now);
                    return receipt;
                });
    }

    private Message.MessageStatus aggregateStatus(Message message) {
        List<Long> recipients = participantIds(message.getChatId())
                .stream()
                .filter(id -> !Objects.equals(id, message.getSenderId()))
                .toList();

        if (recipients.isEmpty()) {
            return Message.MessageStatus.SENT;
        }

        List<MessageReceipt> receipts = messageReceiptRepository.findByMessageId(message.getId());
        Map<Long, List<MessageReceipt>> byUser =
                receipts.stream().collect(Collectors.groupingBy(MessageReceipt::getUserId));

        boolean allRead = true;
        boolean anyDelivered = false;

        for (Long recipientId : recipients) {
            List<MessageReceipt> userReceipts = byUser.getOrDefault(recipientId, List.of());

            boolean userRead = userReceipts.stream().anyMatch(r -> r.getReadAt() != null);
            boolean userDelivered = userRead || userReceipts.stream().anyMatch(r -> r.getDeliveredAt() != null);

            allRead = allRead && userRead;
            anyDelivered = anyDelivered || userDelivered;
        }

        if (allRead) return Message.MessageStatus.READ;
        if (anyDelivered) return Message.MessageStatus.DELIVERED;
        return Message.MessageStatus.SENT;
    }

    private void validateBasicSendRequest(User sender, UserDevice currentDevice, EncryptedSendMessageRequestV2 request) {
        if (request == null || request.getChatId() == null) {
            throw new IllegalArgumentException("chatId is required");
        }
        if (request.getClientMessageId() == null || request.getClientMessageId().isBlank()) {
            throw new IllegalArgumentException("clientMessageId is required");
        }
        if (request.getSenderDeviceId() == null || !request.getSenderDeviceId().equals(currentDevice.getDeviceId())) {
            throw new MessageException("senderDeviceId must match current X-Device-Id");
        }

        requireParticipant(request.getChatId(), sender.getId());
    }

    private void validateEnvelopeTargets(Long chatId, List<EncryptedMessageEnvelopeInput> envelopes) {
        if (envelopes == null || envelopes.isEmpty()) {
            throw new IllegalArgumentException("envelopes are required");
        }

        Set<String> targetIds = new HashSet<>();
        Set<Long> participantIds = participantRepository.findByChatId(chatId)
                .stream()
                .map(ChatParticipant::getUserId)
                .collect(Collectors.toSet());

        for (EncryptedMessageEnvelopeInput envelope : envelopes) {
            if (envelope.getTargetDeviceId() == null || envelope.getTargetDeviceId().isBlank()) {
                throw new IllegalArgumentException("targetDeviceId is required");
            }
            if (!targetIds.add(envelope.getTargetDeviceId())) {
                throw new IllegalArgumentException("Duplicate targetDeviceId: " + envelope.getTargetDeviceId());
            }
            if (envelope.getTargetUserId() == null || !participantIds.contains(envelope.getTargetUserId())) {
                throw new IllegalArgumentException("Envelope targetUserId is not a chat participant");
            }
            if (envelope.getCiphertext() == null || envelope.getCiphertext().isBlank()
                    || envelope.getNonce() == null || envelope.getNonce().isBlank()) {
                throw new IllegalArgumentException("ciphertext and nonce are required");
            }
            if (envelope.getMessageType() == null || envelope.getMessageType().isBlank()) {
                throw new IllegalArgumentException("messageType is required");
            }
            if (envelope.getSenderIdentityPublicKey() == null || envelope.getSenderIdentityPublicKey().isBlank()) {
                throw new IllegalArgumentException("senderIdentityPublicKey is required");
            }

            userDeviceRepository.findByUserIdAndDeviceIdAndActiveTrue(
                            envelope.getTargetUserId(),
                            envelope.getTargetDeviceId()
                    )
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Target device not found: " + envelope.getTargetDeviceId()
                    ));
        }
    }

    private Map<String, MessageEnvelope> persistEnvelopes(Message message, User sender, List<EncryptedMessageEnvelopeInput> inputs) {
        Map<String, MessageEnvelope> byDevice = new HashMap<>();

        for (EncryptedMessageEnvelopeInput input : inputs) {
            UserDevice targetDevice = userDeviceRepository
                    .findByUserIdAndDeviceIdAndActiveTrue(input.getTargetUserId(), input.getTargetDeviceId())
                    .orElseThrow(() -> new IllegalArgumentException("Target device not found: " + input.getTargetDeviceId()));

            MessageEnvelope entity = new MessageEnvelope();
            entity.setMessageId(message.getId());
            entity.setChatId(message.getChatId());
            entity.setTargetUserId(input.getTargetUserId());
            entity.setTargetDeviceDbId(targetDevice.getId());
            entity.setTargetDeviceId(targetDevice.getDeviceId());
            entity.setSenderUserId(sender.getId());
            entity.setSenderDeviceId(message.getSenderDeviceId());
            entity.setMessageType(input.getMessageType());
            entity.setSenderIdentityPublicKey(input.getSenderIdentityPublicKey());
            entity.setEphemeralPublicKey(input.getEphemeralPublicKey());
            entity.setCiphertext(input.getCiphertext());
            entity.setNonce(input.getNonce());
            entity.setSignedPreKeyId(input.getSignedPreKeyId());
            entity.setOneTimePreKeyId(input.getOneTimePreKeyId());
            entity.setMessageIndex(input.getMessageIndex());
            entity.setCreatedAt(LocalDateTime.now());

            entity = messageEnvelopeRepository.save(entity);
            incrementCounter("message_envelopes_persisted_total");
            byDevice.put(entity.getTargetDeviceId(), entity);
        }

        return byDevice;
    }

    private void fanoutCreatedEvent(Message message, Map<String, MessageEnvelope> byDevice) {
        byDevice.forEach((deviceId, envelope) -> messagingTemplate.convertAndSend(
                "/topic/devices/" + deviceId + "/chats/" + message.getChatId(),
                toDeviceEvent("MESSAGE_CREATED", message, envelope, envelope.getTargetUserId())
        ));
    }

    private void fanoutEditedEvent(Message message, Map<String, MessageEnvelope> byDevice) {
        byDevice.forEach((deviceId, envelope) -> messagingTemplate.convertAndSend(
                "/topic/devices/" + deviceId + "/chats/" + message.getChatId(),
                toDeviceEvent("MESSAGE_EDITED", message, envelope, envelope.getTargetUserId())
        ));
    }

    private void fanoutDeleteEvent(Message message) {
        for (Long participantId : participantIds(message.getChatId())) {
            for (UserDevice device : userDeviceRepository.findByUserIdAndActiveTrue(participantId)) {
                messagingTemplate.convertAndSend(
                        "/topic/devices/" + device.getDeviceId() + "/chats/" + message.getChatId(),
                        toDeviceEvent("MESSAGE_DELETED", message, null, participantId)
                );
            }
        }
    }

    private void fanoutReactionEvent(Long chatId, ReactionEvent event) {
        for (Long participantId : participantIds(chatId)) {
            for (UserDevice device : userDeviceRepository.findByUserIdAndActiveTrue(participantId)) {
                messagingTemplate.convertAndSend(
                        "/topic/devices/" + device.getDeviceId() + "/chats/" + chatId,
                        event
                );
            }
        }

        notifyChatListUpdated(chatId, "message_reaction");
    }

    private void sendStatusToSenderDevices(Message message, String status) {
        for (UserDevice device : userDeviceRepository.findByUserIdAndActiveTrue(message.getSenderId())) {
            messagingTemplate.convertAndSend(
                    "/topic/devices/" + device.getDeviceId() + "/status",
                    new StatusUpdateEvent(message.getId(), status)
            );
        }
    }

    private void saveMessageEvent(Message message, Long actorUserId, String eventType, Map<String, Object> payload) {
        try {
            MessageEvent event = new MessageEvent();
            event.setMessageId(message.getId());
            event.setChatId(message.getChatId());
            event.setActorUserId(actorUserId);
            event.setEventType(eventType);
            event.setPayloadJson(objectMapper.writeValueAsString(payload));
            event.setCreatedAt(LocalDateTime.now());
            messageEventRepository.save(event);
            incrementCounter("message_events_total");
        } catch (Exception e) {
            throw new MessageException("Failed to persist message event", e);
        }
    }

    private DeviceMessageEventResponse toDeviceEvent(String type, Message message, MessageEnvelope envelope, Long viewerUserId) {
        return new DeviceMessageEventResponse(
                type,
                message.getId(),
                message.getChatId(),
                message.getSenderId(),
                message.getSenderDeviceId(),
                message.getClientMessageId(),
                message.getVersion(),
                message.getCreatedAt(),
                message.getEditedAt(),
                message.getDeletedAt(),
                message.getStatus().name(),
                envelope == null ? null : new TimelineEnvelopeDto(
                        envelope.getTargetDeviceId(),
                        envelope.getMessageType(),
                        envelope.getSenderIdentityPublicKey(),
                        envelope.getEphemeralPublicKey(),
                        envelope.getCiphertext(),
                        envelope.getNonce(),
                        envelope.getSignedPreKeyId(),
                        envelope.getOneTimePreKeyId(),
                        envelope.getMessageIndex()),
                reactionSummary(message.getId()),
                myReactions(message.getId(), viewerUserId)
        );
    }

    private MessageTimelineItemResponse toTimelineItem(Message message, MessageEnvelope envelope, Long viewerUserId) {
        return new MessageTimelineItemResponse(
                message.getId(),
                message.getChatId(),
                message.getSenderId(),
                message.getSenderDeviceId(),
                message.getClientMessageId(),
                message.getVersion(),
                message.getDeletedAt() != null,
                message.getCreatedAt(),
                message.getEditedAt(),
                message.getStatus().name(),
                envelope == null ? null : new TimelineEnvelopeDto(
                        envelope.getTargetDeviceId(),
                        envelope.getMessageType(),
                        envelope.getSenderIdentityPublicKey(),
                        envelope.getEphemeralPublicKey(),
                        envelope.getCiphertext(),
                        envelope.getNonce(),
                        envelope.getSignedPreKeyId(),
                        envelope.getOneTimePreKeyId(),
                        envelope.getMessageIndex()),
                reactionSummary(message.getId()),
                myReactions(message.getId(), viewerUserId)
        );
    }

    private Map<String, Long> reactionSummary(Long messageId) {
        return messageReactionRepository.findByMessageId(messageId)
                .stream()
                .collect(Collectors.groupingBy(
                        MessageReaction::getEmoji,
                        LinkedHashMap::new,
                        Collectors.counting()
                ));
    }

    private Set<String> myReactions(Long messageId, Long userId) {
        if (userId == null) return Set.of();

        return messageReactionRepository.findByMessageId(messageId)
                .stream()
                .filter(r -> Objects.equals(r.getUserId(), userId))
                .map(MessageReaction::getEmoji)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private String normalizeEmoji(String emoji) {
        String value = String.valueOf(emoji == null ? "" : emoji).trim();
        Set<String> allowed = Set.of("👍", "❤️", "😂", "😮", "😢", "🔥");

        if (!allowed.contains(value)) {
            throw new IllegalArgumentException("Unsupported reaction emoji");
        }

        return value;
    }

    private UserDevice currentDeviceOrNull() {
        return currentDeviceService.requireCurrentDevice();
    }

    private String deviceIdOrFallback(UserDevice currentDevice) {
        return currentDevice == null ? "unknown-device" : currentDevice.getDeviceId();
    }

    private User requireUser(String username) {
        return userIdentityService.require(username);
    }

    private void requireParticipant(Long chatId, Long userId) {
        if (!participantRepository.existsByChatIdAndUserId(chatId, userId)) {
            throw new ChatException("You are not a participant of this chat");
        }
    }

    private List<Long> participantIds(Long chatId) {
        return participantRepository.findByChatId(chatId)
                .stream()
                .map(ChatParticipant::getUserId)
                .distinct()
                .toList();
    }

    private void incrementUnreadForOthers(Long chatId, Long senderId) {
        participantRepository.findByChatId(chatId).forEach(p -> {
            if (!Objects.equals(p.getUserId(), senderId)) {
                unreadService.increment(p.getUserId(), chatId);
            }
        });
    }

    private void notifyChatListUpdated(Long chatId, String reason) {
        participantRepository.findByChatId(chatId).forEach(participant ->
                userRepository.findById(participant.getUserId())
                        .ifPresent(user -> messagingTemplate.convertAndSend(
                                "/topic/users/" + user.getUsername() + "/chats",
                                Map.of(
                                        "chatId", chatId,
                                        "reason", reason,
                                        "timestamp", System.currentTimeMillis()
                                )
                        ))
        );
    }

    @AllArgsConstructor
    @Data
    private static class StatusUpdateEvent {
        private Long messageId;
        private String status;
    }

    @AllArgsConstructor
    @Data
    public static class ReactionEvent {
        private String type;
        private Long messageId;
        private Long chatId;
        private Long actorUserId;
        private String actorDeviceId;
        private String emoji;
        private boolean active;
        private Map<String, Long> reactions;
        private long timestamp;
    }

    private void incrementCounter(String name) {
        try { meterRegistry.counter(name).increment(); } catch (Exception ignored) {}
    }

    private void incrementCounter(String name, double amount) {
        try { meterRegistry.counter(name).increment(amount); } catch (Exception ignored) {}
    }
}
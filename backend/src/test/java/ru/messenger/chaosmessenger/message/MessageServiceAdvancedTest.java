package ru.messenger.chaosmessenger.message;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Pageable;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.chat.domain.Message;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
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
import ru.messenger.chaosmessenger.message.repository.MessageEnvelopeRepository;
import ru.messenger.chaosmessenger.message.repository.MessageEventRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReactionRepository;
import ru.messenger.chaosmessenger.message.repository.MessageReceiptRepository;
import ru.messenger.chaosmessenger.message.repository.MessageRepository;
import ru.messenger.chaosmessenger.message.service.MessageService;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;
import ru.messenger.chaosmessenger.user.service.UserIdentityService;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isA;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MessageServiceAdvancedTest {

    @Mock MessageRepository messageRepository;
    @Mock MessageEnvelopeRepository messageEnvelopeRepository;
    @Mock MessageEventRepository messageEventRepository;
    @Mock MessageReceiptRepository messageReceiptRepository;
    @Mock MessageReactionRepository messageReactionRepository;
    @Mock ChatParticipantRepository participantRepository;
    @Mock UserRepository userRepository;
    @Mock UserIdentityService userIdentityService;
    @Mock UserDeviceRepository userDeviceRepository;
    @Mock CurrentDeviceService currentDeviceService;
    @Mock UnreadService unreadService;
    @Mock SimpMessagingTemplate messagingTemplate;

    private MessageService messageService;

    private User alice;
    private User bob;
    private UserDevice aliceDevice;
    private UserDevice bobDevice;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        bob = TestFixtures.user(2L, "bob");

        aliceDevice = TestFixtures.device(10L, alice.getId(), "alice-phone");
        aliceDevice.setUser(alice);

        bobDevice = TestFixtures.device(20L, bob.getId(), "bob-phone");
        bobDevice.setUser(bob);

        messageService = new MessageService(
                messageRepository,
                messageEnvelopeRepository,
                messageEventRepository,
                messageReceiptRepository,
                messageReactionRepository,
                participantRepository,
                userRepository,
                userIdentityService,
                userDeviceRepository,
                currentDeviceService,
                unreadService,
                messagingTemplate,
                new ObjectMapper(),
                new SimpleMeterRegistry()
        );

        lenient().when(messageReactionRepository.findByMessageId(anyLong())).thenReturn(List.of());
        lenient().when(userRepository.findById(1L)).thenReturn(Optional.of(alice));
        lenient().when(userRepository.findById(2L)).thenReturn(Optional.of(bob));
    }

    @Test
    void sendEncryptedMessagePersistsOnlyEncryptedPlaceholderAndFansOutPerDevice() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());
        stubChatParticipants(100L);
        stubTargetDevice(alice.getId(), "alice-phone", aliceDevice);
        stubTargetDevice(bob.getId(), "bob-phone", bobDevice);

        EncryptedSendMessageRequestV2 request = sendRequest(
                100L,
                "client-500",
                "alice-phone",
                List.of(
                        envelope(alice.getId(), "alice-phone", "WHISPER", 1),
                        envelope(bob.getId(), "bob-phone", "PREKEY_WHISPER", 1)
                )
        );

        when(messageRepository.findByClientMessageId("client-500")).thenReturn(Optional.empty());

        when(messageRepository.save(any(Message.class))).thenAnswer(invocation -> {
            Message message = invocation.getArgument(0);
            if (message.getId() == null) {
                message.setId(500L);
            }
            return message;
        });

        when(messageEnvelopeRepository.save(any(MessageEnvelope.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DeviceMessageEventResponse response = messageService.sendEncryptedMessageV2("alice", request);

        ArgumentCaptor<Message> messageCaptor = ArgumentCaptor.forClass(Message.class);
        verify(messageRepository).save(messageCaptor.capture());

        Message saved = messageCaptor.getValue();

        assertThat(saved.getChatId()).isEqualTo(100L);
        assertThat(saved.getSenderId()).isEqualTo(alice.getId());
        assertThat(saved.getSenderDeviceId()).isEqualTo("alice-phone");
        assertThat(saved.getClientMessageId()).isEqualTo("client-500");
        assertThat(saved.getContent()).isEqualTo("[encrypted]");
        assertThat(saved.getStatus()).isEqualTo(Message.MessageStatus.SENT);

        ArgumentCaptor<MessageEnvelope> envelopeCaptor = ArgumentCaptor.forClass(MessageEnvelope.class);
        verify(messageEnvelopeRepository, atLeastOnce()).save(envelopeCaptor.capture());

        assertThat(envelopeCaptor.getAllValues())
                .extracting(MessageEnvelope::getTargetDeviceId)
                .containsExactlyInAnyOrder("alice-phone", "bob-phone");

        assertThat(envelopeCaptor.getAllValues())
                .allSatisfy(env -> {
                    assertThat(env.getMessageId()).isEqualTo(500L);
                    assertThat(env.getChatId()).isEqualTo(100L);
                    assertThat(env.getSenderUserId()).isEqualTo(alice.getId());
                    assertThat(env.getSenderDeviceId()).isEqualTo("alice-phone");
                    assertThat(env.getCiphertext()).isNotBlank();
                    assertThat(env.getNonce()).isNotBlank();
                });

        verify(unreadService).increment(bob.getId(), 100L);
        verify(unreadService, never()).increment(alice.getId(), 100L);

        assertThat(response.getType()).isEqualTo("MESSAGE_CREATED");
        assertThat(response.getMessageId()).isEqualTo(500L);
        assertThat(response.getEnvelope()).isNotNull();
        assertThat(response.getEnvelope().getTargetDeviceId()).isEqualTo("alice-phone");

        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/alice-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/bob-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
    }

    @Test
    void sendEncryptedMessageRejectsDuplicateEnvelopeTargetBeforeSavingMessage() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());
        stubChatParticipants(100L);
        stubTargetDevice(bob.getId(), "bob-phone", bobDevice);

        EncryptedSendMessageRequestV2 request = sendRequest(
                100L,
                "client-dup",
                "alice-phone",
                List.of(
                        envelope(bob.getId(), "bob-phone", "WHISPER", 1),
                        envelope(bob.getId(), "bob-phone", "WHISPER", 2)
                )
        );

        when(messageRepository.findByClientMessageId("client-dup")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> messageService.sendEncryptedMessageV2("alice", request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Duplicate targetDeviceId: bob-phone");

        verify(messageRepository, never()).save(any(Message.class));
        verify(messageEnvelopeRepository, never()).save(any(MessageEnvelope.class));
    }

    @Test
    void sendEncryptedMessageRejectsEnvelopeForUserOutsideChat() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());
        stubChatParticipants(100L);

        EncryptedSendMessageRequestV2 request = sendRequest(
                100L,
                "client-outside-user",
                "alice-phone",
                List.of(envelope(99L, "ghost-phone", "WHISPER", 1))
        );

        when(messageRepository.findByClientMessageId("client-outside-user")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> messageService.sendEncryptedMessageV2("alice", request))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Envelope targetUserId is not a chat participant");

        verify(userDeviceRepository, never()).findByUserIdAndDeviceIdAndActiveTrue(99L, "ghost-phone");
        verify(messageRepository, never()).save(any(Message.class));
    }

    @Test
    void sendEncryptedMessageRejectsSenderDeviceMismatch() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());

        EncryptedSendMessageRequestV2 request = sendRequest(
                100L,
                "client-wrong-device",
                "evil-device",
                List.of(envelope(bob.getId(), "bob-phone", "WHISPER", 1))
        );

        assertThatThrownBy(() -> messageService.sendEncryptedMessageV2("alice", request))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("senderDeviceId must match current X-Device-Id");

        verify(messageRepository, never()).save(any(Message.class));
    }

    @Test
    void sendEncryptedMessageRejectsNonParticipant() {
        stubAuthenticated(alice, aliceDevice);
        when(participantRepository.existsByChatIdAndUserId(100L, alice.getId())).thenReturn(false);

        EncryptedSendMessageRequestV2 request = sendRequest(
                100L,
                "client-not-participant",
                "alice-phone",
                List.of(envelope(bob.getId(), "bob-phone", "WHISPER", 1))
        );

        assertThatThrownBy(() -> messageService.sendEncryptedMessageV2("alice", request))
                .isInstanceOf(ChatException.class)
                .hasMessageContaining("You are not a participant of this chat");
    }

    @Test
    void getChatTimelineCapsLimitReversesMessagesAndAddsCurrentDeviceEnvelopeAndReactions() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message newest = TestFixtures.sentMessage(2L, 100L, alice.getId(), "alice-phone");
        Message oldest = TestFixtures.sentMessage(1L, 100L, alice.getId(), "alice-phone");

        MessageEnvelope bobEnvelopeForOldest = envelopeEntity(
                1L,
                100L,
                bob.getId(),
                bobDevice,
                "cipher-old",
                "nonce-old",
                1
        );

        MessageReaction bobReaction = reaction(1L, 100L, bob.getId(), "🔥");
        when(messageReactionRepository.findByMessageId(1L)).thenReturn(List.of(bobReaction));
        when(messageReactionRepository.findByMessageId(2L)).thenReturn(List.of());

        when(messageRepository.findByChatIdBefore(eq(100L), eq(99L), any(Pageable.class)))
                .thenReturn(new java.util.ArrayList<>(List.of(newest, oldest)));
        when(messageEnvelopeRepository.findByMessageIdInAndTargetDeviceId(List.of(1L, 2L), "bob-phone"))
                .thenReturn(List.of(bobEnvelopeForOldest));

        List<?> timeline = messageService.getChatTimeline("bob", 100L, 99L, 999);

        assertThat(timeline).hasSize(2);

        var first = (ru.messenger.chaosmessenger.message.dto.MessageTimelineItemResponse) timeline.get(0);
        var second = (ru.messenger.chaosmessenger.message.dto.MessageTimelineItemResponse) timeline.get(1);

        assertThat(first.getId()).isEqualTo(1L);
        assertThat(first.getEnvelope()).isNotNull();
        assertThat(first.getEnvelope().getTargetDeviceId()).isEqualTo("bob-phone");
        assertThat(first.getEnvelope().getCiphertext()).isEqualTo("cipher-old");
        assertThat(first.getMyReactions()).containsExactly("🔥");
        assertThat(first.getReactions()).containsEntry("🔥", 1L);

        assertThat(second.getId()).isEqualTo(2L);
        assertThat(second.getEnvelope()).isNull();

        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(messageRepository).findByChatIdBefore(eq(100L), eq(99L), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(200);
    }

    @Test
    void editEncryptedMessageRejectsNonSender() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));

        EncryptedEditMessageRequestV2 request = editRequest(
                "bob-phone",
                List.of(envelope(bob.getId(), "bob-phone", "WHISPER", 2))
        );

        assertThatThrownBy(() -> messageService.editEncryptedMessageV2("bob", 500L, request))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("You can only edit your own messages");

        verify(messageEnvelopeRepository, never()).deleteByMessageId(500L);
        verify(messageRepository, never()).save(message);
    }

    @Test
    void editEncryptedMessageReplacesEnvelopesIncrementsVersionAndPersistsEditEvent() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());
        stubChatParticipants(100L);
        stubTargetDevice(alice.getId(), "alice-phone", aliceDevice);
        stubTargetDevice(bob.getId(), "bob-phone", bobDevice);

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");
        message.setVersion(1);

        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));
        when(messageRepository.save(message)).thenReturn(message);
        when(messageEnvelopeRepository.save(any(MessageEnvelope.class))).thenAnswer(invocation -> invocation.getArgument(0));

        EncryptedEditMessageRequestV2 request = editRequest(
                "alice-phone",
                List.of(
                        envelope(alice.getId(), "alice-phone", "WHISPER", 2),
                        envelope(bob.getId(), "bob-phone", "WHISPER", 2)
                )
        );

        DeviceMessageEventResponse response = messageService.editEncryptedMessageV2("alice", 500L, request);

        assertThat(response.getType()).isEqualTo("MESSAGE_EDITED");
        assertThat(message.getVersion()).isEqualTo(2);
        assertThat(message.getEditedAt()).isNotNull();

        verify(messageEnvelopeRepository).deleteByMessageId(500L);
        verify(messageEnvelopeRepository).flush();

        ArgumentCaptor<MessageEvent> eventCaptor = ArgumentCaptor.forClass(MessageEvent.class);
        verify(messageEventRepository).save(eventCaptor.capture());

        MessageEvent event = eventCaptor.getValue();
        assertThat(event.getMessageId()).isEqualTo(500L);
        assertThat(event.getChatId()).isEqualTo(100L);
        assertThat(event.getActorUserId()).isEqualTo(alice.getId());
        assertThat(event.getEventType()).isEqualTo("EDIT");
        assertThat(event.getPayloadJson()).contains("\"version\":2");

        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/alice-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/bob-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
    }

    @Test
    void editEncryptedMessageRejectsDeletedMessage() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");
        message.setDeletedAt(LocalDateTime.now());

        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));

        EncryptedEditMessageRequestV2 request = editRequest(
                "alice-phone",
                List.of(envelope(alice.getId(), "alice-phone", "WHISPER", 2))
        );

        assertThatThrownBy(() -> messageService.editEncryptedMessageV2("alice", 500L, request))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("Deleted messages cannot be edited");

        verify(messageEnvelopeRepository, never()).deleteByMessageId(500L);
    }

    @Test
    void deleteMessageSoftDeletesPersistsEventAndFansOutToEveryActiveParticipantDevice() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());
        stubChatParticipants(100L);

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");

        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));
        when(messageRepository.save(message)).thenReturn(message);
        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId())).thenReturn(List.of(aliceDevice));
        when(userDeviceRepository.findByUserIdAndActiveTrue(bob.getId())).thenReturn(List.of(bobDevice));

        messageService.deleteMessage("alice", 500L);

        assertThat(message.getDeletedAt()).isNotNull();
        verify(messageRepository).save(message);

        ArgumentCaptor<MessageEvent> eventCaptor = ArgumentCaptor.forClass(MessageEvent.class);
        verify(messageEventRepository).save(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getEventType()).isEqualTo("DELETE");
        assertThat(eventCaptor.getValue().getPayloadJson()).isEqualTo("{}");

        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/alice-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/bob-phone/chats/100"),
                isA(DeviceMessageEventResponse.class)
        );
    }

    @Test
    void deleteMessageIsIdempotentWhenMessageAlreadyDeleted() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");
        message.setDeletedAt(LocalDateTime.now().minusMinutes(1));

        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));

        messageService.deleteMessage("alice", 500L);

        verify(messageRepository, never()).save(message);
        verify(messageEventRepository, never()).save(any(MessageEvent.class));
    }

    @Test
    void deleteMessageRejectsNonSender() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message message = TestFixtures.sentMessage(500L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(500L)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> messageService.deleteMessage("bob", 500L))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("You can only delete your own messages");

        verify(messageRepository, never()).save(message);
    }

    @Test
    void markChatAsReadResetsUnreadUpsertsReadAndPromotesAggregateStatusToRead() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());
        stubChatParticipants(100L);

        Message message = TestFixtures.sentMessage(700L, 100L, alice.getId(), "alice-phone");

        when(messageRepository.findByChatIdAndSenderIdNot(100L, bob.getId()))
                .thenReturn(List.of(message));
        when(messageReceiptRepository.findByMessageId(700L))
                .thenReturn(List.of(readReceipt(message, bob.getId(), "bob-phone")));
        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId()))
                .thenReturn(List.of(aliceDevice));
        when(messageRepository.save(message)).thenReturn(message);

        messageService.markChatAsRead("bob", 100L);

        verify(unreadService).reset(bob.getId(), 100L);
        verify(messageReceiptRepository).upsertRead(
                eq(700L),
                eq(100L),
                eq(bob.getId()),
                eq("bob-phone"),
                any(LocalDateTime.class)
        );

        assertThat(message.getStatus()).isEqualTo(Message.MessageStatus.READ);
        verify(messageRepository).save(message);
    }

    @Test
    void markChatAsDeliveredSkipsAlreadyReadMessagesAndPromotesSentMessagesToDelivered() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());
        stubChatParticipants(100L);

        Message sent = TestFixtures.sentMessage(701L, 100L, alice.getId(), "alice-phone");
        Message alreadyRead = TestFixtures.sentMessage(702L, 100L, alice.getId(), "alice-phone");
        alreadyRead.setStatus(Message.MessageStatus.READ);

        when(messageRepository.findByChatIdAndSenderIdNot(100L, bob.getId()))
                .thenReturn(List.of(sent, alreadyRead));
        when(messageReceiptRepository.findByMessageId(701L))
                .thenReturn(List.of(deliveredReceipt(sent, bob.getId(), "bob-phone")));
        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId()))
                .thenReturn(List.of(aliceDevice));
        when(messageRepository.save(sent)).thenReturn(sent);

        messageService.markChatAsDelivered("bob", 100L);

        verify(messageReceiptRepository).upsertDelivered(
                eq(701L),
                eq(100L),
                eq(bob.getId()),
                eq("bob-phone"),
                any(LocalDateTime.class)
        );
        verify(messageReceiptRepository, never()).upsertDelivered(
                eq(702L),
                eq(100L),
                eq(bob.getId()),
                eq("bob-phone"),
                any(LocalDateTime.class)
        );

        assertThat(sent.getStatus()).isEqualTo(Message.MessageStatus.DELIVERED);
        assertThat(alreadyRead.getStatus()).isEqualTo(Message.MessageStatus.READ);
        verify(messageRepository).save(sent);
    }

    @Test
    void updateMessageStatusDoesNothingWhenSenderUpdatesOwnMessage() {
        stubAuthenticated(alice, aliceDevice);
        stubParticipant(100L, alice.getId());

        Message message = TestFixtures.sentMessage(800L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(800L)).thenReturn(Optional.of(message));

        messageService.updateMessageStatus("alice", 800L, "READ");

        verify(messageReceiptRepository, never()).upsertRead(anyLong(), anyLong(), anyLong(), any(), any());
        verify(messageReceiptRepository, never()).upsertDelivered(anyLong(), anyLong(), anyLong(), any(), any());
        verify(messageRepository, never()).save(message);
    }

    @Test
    void updateMessageStatusRejectsInvalidStatusBeforeReceiptMutation() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message message = TestFixtures.sentMessage(800L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(800L)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> messageService.updateMessageStatus("bob", 800L, "BOGUS"))
                .isInstanceOf(IllegalArgumentException.class);

        verify(messageReceiptRepository, never()).upsertRead(anyLong(), anyLong(), anyLong(), any(), any());
        verify(messageReceiptRepository, never()).upsertDelivered(anyLong(), anyLong(), anyLong(), any(), any());
    }

    @Test
    void updateMessageStatusReadWritesReadReceiptAndPromotesAggregateToRead() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());
        stubChatParticipants(100L);

        Message message = TestFixtures.sentMessage(801L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(801L)).thenReturn(Optional.of(message));
        when(messageReceiptRepository.findByMessageId(801L))
                .thenReturn(List.of(readReceipt(message, bob.getId(), "bob-phone")));
        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId()))
                .thenReturn(List.of(aliceDevice));
        when(messageRepository.save(message)).thenReturn(message);

        messageService.updateMessageStatus("bob", 801L, "READ");

        verify(messageReceiptRepository).upsertRead(
                eq(801L),
                eq(100L),
                eq(bob.getId()),
                eq("bob-phone"),
                any(LocalDateTime.class)
        );

        assertThat(message.getStatus()).isEqualTo(Message.MessageStatus.READ);
        verify(messageRepository).save(message);
    }

    @Test
    void toggleReactionRemovesExistingReactionAndReturnsInactiveEvent() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());
        stubChatParticipants(100L);

        Message message = TestFixtures.sentMessage(900L, 100L, alice.getId(), "alice-phone");
        MessageReaction existing = reaction(900L, 100L, bob.getId(), "🔥");

        when(messageRepository.findById(900L)).thenReturn(Optional.of(message));
        when(messageReactionRepository.findByMessageIdAndUserIdAndEmoji(900L, bob.getId(), "🔥"))
                .thenReturn(Optional.of(existing));
        when(userDeviceRepository.findByUserIdAndActiveTrue(alice.getId())).thenReturn(List.of(aliceDevice));
        when(userDeviceRepository.findByUserIdAndActiveTrue(bob.getId())).thenReturn(List.of(bobDevice));

        MessageService.ReactionEvent event = messageService.toggleReaction("bob", 900L, " 🔥 ");

        assertThat(event.getType()).isEqualTo("MESSAGE_REACTION");
        assertThat(event.getMessageId()).isEqualTo(900L);
        assertThat(event.getActorUserId()).isEqualTo(bob.getId());
        assertThat(event.getActorDeviceId()).isEqualTo("bob-phone");
        assertThat(event.getEmoji()).isEqualTo("🔥");
        assertThat(event.isActive()).isFalse();

        verify(messageReactionRepository).delete(existing);

        ArgumentCaptor<MessageEvent> eventCaptor = ArgumentCaptor.forClass(MessageEvent.class);
        verify(messageEventRepository).save(eventCaptor.capture());
        assertThat(eventCaptor.getValue().getEventType()).isEqualTo("REACTION");
        assertThat(eventCaptor.getValue().getPayloadJson()).contains("\"emoji\":\"🔥\"");
        assertThat(eventCaptor.getValue().getPayloadJson()).contains("\"active\":false");

        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/alice-phone/chats/100"),
                isA(MessageService.ReactionEvent.class)
        );
        verify(messagingTemplate).convertAndSend(
                eq("/topic/devices/bob-phone/chats/100"),
                isA(MessageService.ReactionEvent.class)
        );
    }

    @Test
    void toggleReactionRejectsUnsupportedEmojiBeforeMutation() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message message = TestFixtures.sentMessage(900L, 100L, alice.getId(), "alice-phone");
        when(messageRepository.findById(900L)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> messageService.toggleReaction("bob", 900L, "💣"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unsupported reaction emoji");

        verify(messageReactionRepository, never()).save(any(MessageReaction.class));
        verify(messageReactionRepository, never()).delete(any(MessageReaction.class));
        verify(messageEventRepository, never()).save(any(MessageEvent.class));
    }

    @Test
    void toggleReactionRejectsDeletedMessage() {
        stubAuthenticated(bob, bobDevice);
        stubParticipant(100L, bob.getId());

        Message message = TestFixtures.sentMessage(900L, 100L, alice.getId(), "alice-phone");
        message.setDeletedAt(LocalDateTime.now());

        when(messageRepository.findById(900L)).thenReturn(Optional.of(message));

        assertThatThrownBy(() -> messageService.toggleReaction("bob", 900L, "👍"))
                .isInstanceOf(MessageException.class)
                .hasMessageContaining("Cannot react to deleted message");

        verify(messageReactionRepository, never()).save(any(MessageReaction.class));
        verify(messageReactionRepository, never()).delete(any(MessageReaction.class));
    }

    private void stubAuthenticated(User user, UserDevice currentDevice) {
        when(userIdentityService.require(user.getUsername())).thenReturn(user);
        when(currentDeviceService.requireCurrentDevice()).thenReturn(currentDevice);
    }

    private void stubParticipant(Long chatId, Long userId) {
        when(participantRepository.existsByChatIdAndUserId(chatId, userId)).thenReturn(true);
    }

    private void stubChatParticipants(Long chatId) {
        when(participantRepository.findByChatId(chatId)).thenReturn(List.of(
                TestFixtures.participant(chatId, alice.getId()),
                TestFixtures.participant(chatId, bob.getId())
        ));
    }

    private void stubTargetDevice(Long userId, String deviceId, UserDevice device) {
        when(userDeviceRepository.findByUserIdAndDeviceIdAndActiveTrue(userId, deviceId))
                .thenReturn(Optional.of(device));
    }

    private static EncryptedSendMessageRequestV2 sendRequest(
            Long chatId,
            String clientMessageId,
            String senderDeviceId,
            List<EncryptedMessageEnvelopeInput> envelopes
    ) {
        EncryptedSendMessageRequestV2 request = new EncryptedSendMessageRequestV2();
        request.setChatId(chatId);
        request.setClientMessageId(clientMessageId);
        request.setSenderDeviceId(senderDeviceId);
        request.setEnvelopes(envelopes);
        return request;
    }

    private static EncryptedEditMessageRequestV2 editRequest(
            String senderDeviceId,
            List<EncryptedMessageEnvelopeInput> envelopes
    ) {
        EncryptedEditMessageRequestV2 request = new EncryptedEditMessageRequestV2();
        request.setSenderDeviceId(senderDeviceId);
        request.setEnvelopes(envelopes);
        return request;
    }

    private static EncryptedMessageEnvelopeInput envelope(
            Long targetUserId,
            String targetDeviceId,
            String messageType,
            Integer messageIndex
    ) {
        EncryptedMessageEnvelopeInput envelope = new EncryptedMessageEnvelopeInput();
        envelope.setTargetUserId(targetUserId);
        envelope.setTargetDeviceId(targetDeviceId);
        envelope.setMessageType(messageType);
        envelope.setSenderIdentityPublicKey("sender-identity-key");
        envelope.setEphemeralPublicKey("ephemeral-key");
        envelope.setCiphertext("ciphertext-for-" + targetDeviceId);
        envelope.setNonce("nonce-for-" + targetDeviceId);
        envelope.setSignedPreKeyId(7);
        envelope.setOneTimePreKeyId(11);
        envelope.setTimestamp(123456L);
        envelope.setMessageIndex(messageIndex);
        return envelope;
    }

    private static MessageEnvelope envelopeEntity(
            Long messageId,
            Long chatId,
            Long targetUserId,
            UserDevice targetDevice,
            String ciphertext,
            String nonce,
            Integer messageIndex
    ) {
        MessageEnvelope envelope = new MessageEnvelope();
        envelope.setId(messageId * 10);
        envelope.setMessageId(messageId);
        envelope.setChatId(chatId);
        envelope.setTargetUserId(targetUserId);
        envelope.setTargetDeviceDbId(targetDevice.getId());
        envelope.setTargetDeviceId(targetDevice.getDeviceId());
        envelope.setSenderUserId(1L);
        envelope.setSenderDeviceId("alice-phone");
        envelope.setMessageType("WHISPER");
        envelope.setSenderIdentityPublicKey("sender-identity-key");
        envelope.setEphemeralPublicKey("ephemeral-key");
        envelope.setCiphertext(ciphertext);
        envelope.setNonce(nonce);
        envelope.setSignedPreKeyId(7);
        envelope.setOneTimePreKeyId(11);
        envelope.setMessageIndex(messageIndex);
        envelope.setCreatedAt(LocalDateTime.now());
        return envelope;
    }

    private static MessageReaction reaction(Long messageId, Long chatId, Long userId, String emoji) {
        MessageReaction reaction = new MessageReaction();
        reaction.setId(messageId + userId);
        reaction.setMessageId(messageId);
        reaction.setChatId(chatId);
        reaction.setUserId(userId);
        reaction.setEmoji(emoji);
        reaction.setCreatedAt(LocalDateTime.now());
        return reaction;
    }

    private static MessageReceipt deliveredReceipt(Message message, Long userId, String deviceId) {
        MessageReceipt receipt = baseReceipt(message, userId, deviceId);
        receipt.setDeliveredAt(LocalDateTime.now());
        return receipt;
    }

    private static MessageReceipt readReceipt(Message message, Long userId, String deviceId) {
        MessageReceipt receipt = baseReceipt(message, userId, deviceId);
        receipt.setDeliveredAt(LocalDateTime.now());
        receipt.setReadAt(LocalDateTime.now());
        return receipt;
    }

    private static MessageReceipt baseReceipt(Message message, Long userId, String deviceId) {
        MessageReceipt receipt = new MessageReceipt();
        receipt.setId(message.getId() + userId);
        receipt.setMessageId(message.getId());
        receipt.setChatId(message.getChatId());
        receipt.setUserId(userId);
        receipt.setDeviceId(deviceId);
        receipt.setCreatedAt(LocalDateTime.now());
        receipt.setUpdatedAt(LocalDateTime.now());
        return receipt;
    }
}
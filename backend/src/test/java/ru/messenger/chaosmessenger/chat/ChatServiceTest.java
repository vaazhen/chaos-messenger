package ru.messenger.chaosmessenger.chat;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import ru.messenger.chaosmessenger.TestFixtures;
import ru.messenger.chaosmessenger.chat.domain.Chat;
import ru.messenger.chaosmessenger.chat.domain.ChatParticipant;
import ru.messenger.chaosmessenger.chat.dto.ChatResponse;
import ru.messenger.chaosmessenger.chat.repository.ChatParticipantRepository;
import ru.messenger.chaosmessenger.chat.repository.ChatRepository;
import ru.messenger.chaosmessenger.chat.service.ChatService;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.infra.presence.OnlineService;
import ru.messenger.chaosmessenger.infra.presence.UnreadService;
import ru.messenger.chaosmessenger.message.repository.MessageRepository;
import ru.messenger.chaosmessenger.user.domain.User;
import ru.messenger.chaosmessenger.user.repository.UserRepository;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("ChatService")
class ChatServiceTest {

    @Mock UserRepository userRepository;
    @Mock ChatRepository chatRepository;
    @Mock ChatParticipantRepository participantRepository;
    @Mock MessageRepository messageRepository;
    @Mock UnreadService unreadService;
    @Mock OnlineService onlineService;
    @Mock SimpMessagingTemplate messagingTemplate;
    @Mock MessageSource messageSource;

    @InjectMocks ChatService chatService;

    User alice;
    User bob;

    @BeforeEach
    void setUp() {
        alice = TestFixtures.user(1L, "alice");
        bob   = TestFixtures.user(2L, "bob");

        lenient().when(messageSource.getMessage(
                eq("chat.saved.name"),
                isNull(),
                eq("Saved Messages"),
                any(Locale.class)
        )).thenReturn("Saved Messages");
    }

    // ─── createDirectChat ───────────────────────────────────────────────────

    @Nested
    @DisplayName("createDirectChat")
    class CreateDirectChat {

        @Test
        @DisplayName("creates a new chat when it does not exist yet")
        void createsNewChat() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findById(2L)).thenReturn(Optional.of(bob));
            when(participantRepository.findDirectChatId(1L, 2L)).thenReturn(Optional.empty());

            Chat saved = TestFixtures.directChat(10L);
            when(chatRepository.save(any())).thenReturn(saved);
            when(participantRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            Long chatId = chatService.createDirectChat("alice", 2L);

            assertThat(chatId).isEqualTo(10L);
            verify(chatRepository).save(any());
            verify(participantRepository, times(2)).save(any()); // alice + bob
        }

        @Test
        @DisplayName("creates DIRECT chat when the users only share a GROUP chat")
        void createsDirectChatWhenOnlySharedChatIsGroup() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findById(2L)).thenReturn(Optional.of(bob));

            // Репозиторий должен игнорировать GROUP-чаты и возвращать только настоящий DIRECT.
            when(participantRepository.findDirectChatId(1L, 2L)).thenReturn(Optional.empty());

            Chat saved = TestFixtures.directChat(10L);
            when(chatRepository.save(any())).thenReturn(saved);
            when(participantRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            Long chatId = chatService.createDirectChat("alice", 2L);

            assertThat(chatId).isEqualTo(10L);
            verify(chatRepository).save(argThat(chat -> "DIRECT".equals(chat.getType())));
            verify(participantRepository, times(2)).save(any());
            verify(participantRepository).findDirectChatId(1L, 2L);
        }

        @Test
        @DisplayName("returns an existing chat without duplication")
        void returnsExistingChat() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findById(2L)).thenReturn(Optional.of(bob));
            when(participantRepository.findDirectChatId(1L, 2L)).thenReturn(Optional.of(99L));

            Long chatId = chatService.createDirectChat("alice", 2L);

            assertThat(chatId).isEqualTo(99L);
            verify(chatRepository, never()).save(any());
        }

        @Test
        @DisplayName("rejects creating a chat with yourself")
        void rejectsSelfChat() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findById(1L)).thenReturn(Optional.of(alice));

            assertThatThrownBy(() -> chatService.createDirectChat("alice", 1L))
                    .isInstanceOf(ChatException.class)
                    .hasMessageContaining("yourself");
        }

        @Test
        @DisplayName("throws ChatException when target user is not found")
        void throwsIfTargetNotFound() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findById(999L)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> chatService.createDirectChat("alice", 999L))
                    .isInstanceOf(ChatException.class);
        }
    }

    // ─── createGroupChat ────────────────────────────────────────────────────

    @Nested
    @DisplayName("createGroupChat")
    class CreateGroupChat {

        @Test
        @DisplayName("creates a group chat with several participants")
        void createsGroup() {
            User charlie = TestFixtures.user(3L, "charlie");
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(userRepository.findAllById(List.of(2L, 3L))).thenReturn(List.of(bob, charlie));

            Chat saved = TestFixtures.groupChat(20L, "Team");
            when(chatRepository.save(any())).thenReturn(saved);
            when(participantRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            Long chatId = chatService.createGroupChat("alice", "Team", List.of(2L, 3L));

            assertThat(chatId).isEqualTo(20L);
            // alice + bob + charlie = 3 rows in chat_participants
            verify(participantRepository, times(3)).save(any());
        }

        @Test
        @DisplayName("rejects creating a group without a name")
        void rejectsBlankName() {
            // Validation happens before userRepository is called, so no stub is needed
            assertThatThrownBy(() -> chatService.createGroupChat("alice", "  ", List.of(2L)))
                    .isInstanceOf(ChatException.class)
                    .hasMessageContaining("name");
        }

        @Test
        @DisplayName("rejects creating a group without members")
        void rejectsEmptyMembers() {
            // Validation happens before userRepository is called, so no stub is needed
            assertThatThrownBy(() -> chatService.createGroupChat("alice", "Group", List.of()))
                    .isInstanceOf(ChatException.class)
                    .hasMessageContaining("member");
        }
    }

    // ─── getMyChats ──────────────────────────────────────────────────────────

    @Nested
    @DisplayName("getMyChats")
    class GetMyChats {

        @Test
        @DisplayName("returns an empty list when there are no chats")
        void returnsEmptyList() {
            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(participantRepository.findByUserId(1L)).thenReturn(List.of());

            assertThat(chatService.getMyChats("alice")).isEmpty();
        }

        @Test
        @DisplayName("returns a DIRECT chat with peer data")
        void returnsDirectChatWithOtherUser() {
            Chat chat = TestFixtures.directChat(5L);
            ChatParticipant pAlice = TestFixtures.participant(5L, 1L);
            ChatParticipant pBob   = TestFixtures.participant(5L, 2L);

            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(participantRepository.findByUserId(1L)).thenReturn(List.of(pAlice));
            when(chatRepository.findByIdIn(List.of(5L))).thenReturn(List.of(chat));
            when(participantRepository.findByChatIdIn(List.of(5L))).thenReturn(List.of(pAlice, pBob));
            when(userRepository.findAllById(anySet())).thenReturn(List.of(bob));
            when(unreadService.get(1L, 5L)).thenReturn(3L);
            when(onlineService.isOnline("bob")).thenReturn(true);

            List<ChatResponse> result = chatService.getMyChats("alice");

            assertThat(result).hasSize(1);
            ChatResponse r = result.get(0);
            assertThat(r.getChatId()).isEqualTo(5L);
            assertThat(r.getType()).isEqualTo("DIRECT");
            assertThat(r.getOtherUsername()).isEqualTo("bob");
            assertThat(r.getUnreadCount()).isEqualTo(3L);
            assertThat(r.isOnline()).isTrue();
        }

        @Test
        @DisplayName("returns a GROUP chat with the group name")
        void returnsGroupChatWithName() {
            Chat group = TestFixtures.groupChat(7L, "Project X");
            ChatParticipant pAlice = TestFixtures.participant(7L, 1L);
            ChatParticipant pBob   = TestFixtures.participant(7L, 2L);

            when(userRepository.findByUsername("alice")).thenReturn(Optional.of(alice));
            when(participantRepository.findByUserId(1L)).thenReturn(List.of(pAlice));
            when(chatRepository.findByIdIn(List.of(7L))).thenReturn(List.of(group));
            when(participantRepository.findByChatIdIn(List.of(7L))).thenReturn(List.of(pAlice, pBob));
            when(userRepository.findAllById(anySet())).thenReturn(List.of(bob));
            when(unreadService.get(1L, 7L)).thenReturn(0L);

            List<ChatResponse> result = chatService.getMyChats("alice");

            assertThat(result).hasSize(1);
            ChatResponse r = result.get(0);
            assertThat(r.getType()).isEqualTo("GROUP");
            assertThat(r.getName()).isEqualTo("Project X");
            assertThat(r.getOtherUsername()).isNull();
        }
    }
}

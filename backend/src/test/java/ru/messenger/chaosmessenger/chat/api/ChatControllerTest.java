package ru.messenger.chaosmessenger.chat.api;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import ru.messenger.chaosmessenger.chat.dto.ChatResponse;
import ru.messenger.chaosmessenger.chat.service.ChatService;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatControllerTest {

    @Mock ChatService chatService;
    @Mock Authentication authentication;

    @InjectMocks ChatController controller;

    @Test
    void createDirectChatDelegatesToService() {
        when(authentication.getName()).thenReturn("alice");
        when(chatService.createDirectChat("alice", 2L)).thenReturn(100L);

        Map<String, Object> response = controller.createChat(2L, authentication);

        assertThat(response).containsEntry("chatId", 100L);
        verify(chatService).createDirectChat("alice", 2L);
    }

    @Test
    void createSavedDelegatesToService() {
        when(authentication.getName()).thenReturn("alice");
        when(chatService.createOrGetSavedMessagesChat("alice")).thenReturn(101L);

        Map<String, Object> response = controller.createSaved(authentication);

        assertThat(response).containsEntry("chatId", 101L);
        verify(chatService).createOrGetSavedMessagesChat("alice");
    }

    @Test
    void getMyChatsDelegatesToService() {
        ChatResponse chat = new ChatResponse(
                100L,
                "DIRECT",
                null,
                "encrypted",
                500L,
                LocalDateTime.now(),
                1L,
                List.of(1L, 2L),
                2L,
                "bob",
                "Bob",
                "Brown",
                "bob.png",
                3L,
                true,
                LocalDateTime.now()
        );

        when(authentication.getName()).thenReturn("alice");
        when(chatService.getMyChats("alice")).thenReturn(List.of(chat));

        List<ChatResponse> response = controller.getMyChats(authentication);

        assertThat(response).containsExactly(chat);
        verify(chatService).getMyChats("alice");
    }

    @Test
    void createDirectByUsernameDelegatesToService() {
        when(authentication.getName()).thenReturn("alice");
        when(chatService.createOrGetDirectChatByUsername("alice", "bob")).thenReturn(102L);

        Map<String, Object> response = controller.createOrGetDirectByUsername("bob", authentication);

        assertThat(response).containsEntry("chatId", 102L);
        verify(chatService).createOrGetDirectChatByUsername("alice", "bob");
    }

    @Test
    void createGroupChatDelegatesNameAndMemberIds() {
        ChatController.CreateGroupRequest request = new ChatController.CreateGroupRequest();
        request.setName("Team");
        request.setMemberIds(List.of(2L, 3L));

        when(authentication.getName()).thenReturn("alice");
        when(chatService.createGroupChat("alice", "Team", List.of(2L, 3L))).thenReturn(200L);

        Map<String, Object> response = controller.createGroupChat(request, authentication);

        assertThat(response).containsEntry("chatId", 200L);
        verify(chatService).createGroupChat("alice", "Team", List.of(2L, 3L));
    }
}
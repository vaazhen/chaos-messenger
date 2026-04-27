package ru.messenger.chaosmessenger.message.api;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import ru.messenger.chaosmessenger.infra.ws.WebSocketAuthChannelInterceptor;

@Slf4j
@Controller
@RequiredArgsConstructor
public class ChatMessageController {

    private final SimpMessagingTemplate messagingTemplate;
    private final WebSocketAuthChannelInterceptor authInterceptor;

    @MessageMapping("/chat.sendMessage")
    public void sendMessage(@Payload ChatMessageRequest request, @Header("simpSessionId") String sessionId) {
        String username = authInterceptor.getUsernameBySessionId(sessionId);
        
        if (username == null) {
            log.warn("No username for message event, sessionId: {}", sessionId);
            return;
        }

        log.debug("💬 Message from {} in chat {}: {}", username, request.getChatId(), request.getContent());

        messagingTemplate.convertAndSend(
                "/topic/chat/" + request.getChatId(),
                new ChatMessageEvent(request.getChatId(), username, request.getContent(), System.currentTimeMillis())
        );
    }

    @Data
    public static class ChatMessageRequest {
        private Long chatId;
        private String content;
        private Long replyToId;
        private String imageBase64;
    }

    @Data
    public static class ChatMessageEvent {
        private Long chatId;
        private String senderUsername;
        private String content;
        private long timestamp;

        public ChatMessageEvent(Long chatId, String senderUsername, String content, long timestamp) {
            this.chatId = chatId;
            this.senderUsername = senderUsername;
            this.content = content;
            this.timestamp = timestamp;
        }
    }
}

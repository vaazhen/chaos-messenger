package ru.messenger.chaosmessenger.message.api;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import ru.messenger.chaosmessenger.infra.ws.WebSocketAuthChannelInterceptor;
import ru.messenger.chaosmessenger.message.dto.TypingEvent;
import ru.messenger.chaosmessenger.message.dto.TypingRequest;

@Slf4j
@Controller
@RequiredArgsConstructor
public class TypingController {

    private final SimpMessagingTemplate messagingTemplate;
    private final WebSocketAuthChannelInterceptor authInterceptor;

    @MessageMapping("/typing")
    public void typing(@Payload TypingRequest request, @Header("simpSessionId") String sessionId) {
        String username = authInterceptor.getUsernameBySessionId(sessionId);

        if (username == null) {
            log.warn("No username for typing event, sessionId: {}", sessionId);
            return;
        }

        log.debug("✏️ Typing event from {} in chat {}: {}", username, request.getChatId(), request.isTyping());

        messagingTemplate.convertAndSend(
                "/topic/chats/" + request.getChatId() + "/typing",
                new TypingEvent(username, request.isTyping())
        );
    }
}
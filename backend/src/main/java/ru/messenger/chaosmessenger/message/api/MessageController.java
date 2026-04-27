package ru.messenger.chaosmessenger.message.api;

import jakarta.validation.Valid;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedEditMessageRequestV2;
import ru.messenger.chaosmessenger.crypto.dto.EncryptedSendMessageRequestV2;
import ru.messenger.chaosmessenger.message.dto.DeviceMessageEventResponse;
import ru.messenger.chaosmessenger.message.dto.MessageTimelineItemResponse;
import ru.messenger.chaosmessenger.message.dto.UpdateMessageStatusRequest;
import ru.messenger.chaosmessenger.message.service.MessageService;
import ru.messenger.chaosmessenger.message.service.MessageService.ReactionEvent;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/messages")
@RequiredArgsConstructor
public class MessageController {

    private final MessageService messageService;

    @PostMapping("/encrypted/v2")
    public DeviceMessageEventResponse sendEncryptedMessage(
            @Valid @RequestBody EncryptedSendMessageRequestV2 request,
            Authentication authentication) {
        return messageService.sendEncryptedMessageV2(authentication.getName(), request);
    }

    @GetMapping("/chat/{chatId}/timeline")
    public List<MessageTimelineItemResponse> getChatTimeline(
            @PathVariable Long chatId,
            @RequestParam(required = false) Long beforeMessageId,
            @RequestParam(defaultValue = "50") int limit,
            Authentication authentication) {
        return messageService.getChatTimeline(authentication.getName(), chatId, beforeMessageId, limit);
    }

    @PostMapping("/chat/{chatId}/read")
    public void markChatRead(@PathVariable Long chatId, Authentication authentication) {
        messageService.markChatAsRead(authentication.getName(), chatId);
    }

    @PostMapping("/chat/{chatId}/delivered")
    public void markChatDelivered(@PathVariable Long chatId, Authentication authentication) {
        messageService.markChatAsDelivered(authentication.getName(), chatId);
    }

    @PostMapping("/status")
    public void updateStatus(@Valid @RequestBody UpdateMessageStatusRequest request, Authentication authentication) {
        messageService.updateMessageStatus(authentication.getName(), request.getMessageId(), request.getStatus());
    }

    @PutMapping("/{messageId}/encrypted/v2")
    public DeviceMessageEventResponse editMessage(
            @PathVariable Long messageId,
            @Valid @RequestBody EncryptedEditMessageRequestV2 request,
            Authentication authentication) {
        return messageService.editEncryptedMessageV2(authentication.getName(), messageId, request);
    }

    @PutMapping("/{messageId}/reactions")
    public ReactionEvent toggleReaction(
            @PathVariable Long messageId,
            @Valid @RequestBody ReactionRequest request,
            Authentication authentication) {
        return messageService.toggleReaction(authentication.getName(), messageId, request.getEmoji());
    }

    @DeleteMapping("/{messageId}")
    public Map<String, Object> deleteMessage(@PathVariable Long messageId, Authentication authentication) {
        messageService.deleteMessage(authentication.getName(), messageId);
        return Map.of("success", true);
    }

    @Data
    public static class ReactionRequest {
        private String emoji;
    }

    @Data
    public static class EditMessageRequest {
        private String content;
    }
}
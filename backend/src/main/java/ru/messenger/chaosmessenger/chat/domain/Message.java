package ru.messenger.chaosmessenger.chat.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * A chat message.
 *
 * <p><b>Important:</b> the {@link #content} field always contains the string {@code "[encrypted]"} —
 * the server never stores or sees the plaintext. The actual content is held in
 * per-device encrypted {@code MessageEnvelope} records.
 *
 * <p>Delivery lifecycle: {@code SENT} → {@code DELIVERED} → {@code READ}.
 * Transitions are triggered by the recipient via REST endpoints or WebSocket.
 *
 * <p>Deletion is a soft delete: {@link #deletedAt} is set and the row stays in the DB.
 * Clients hide messages where {@code deleted == true}.
 *
 * <p>Editing uses versioning: each edit increments {@link #version} and updates
 * {@link #editedAt}. Old envelopes are deleted and replaced with new ones.
 */
@Entity
@Table(name = "messages")
@Getter
@Setter
public class Message {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** ID of the chat this message belongs to. */
    @Column(name = "chat_id", nullable = false)
    private Long chatId;

    /** Sender user ID. */
    @Column(name = "sender_id", nullable = false)
    private Long senderId;

    /**
     * String device ID of the sender (value of the {@code X-Device-Id} request header).
     * Required for correct fanout routing to WebSocket topics.
     */
    @Column(name = "sender_device_id", nullable = false, length = 100)
    private String senderDeviceId;

    /**
     * Client-generated identifier (UUID).
     * Used for idempotency: re-sending the same {@code clientMessageId} must not
     * create a duplicate message.
     */
    @Column(name = "client_message_id", nullable = false, length = 100, unique = true)
    private String clientMessageId;

    /**
     * Always {@code "[encrypted]"} — the server never stores plaintext.
     * Clients decrypt the actual content from the corresponding {@code MessageEnvelope}.
     */
    @Column(columnDefinition = "text")
    private String content;

    /**
     * Content type: {@code "ENCRYPTED"} for regular messages.
     * Reserved for future types (system events, file transfers).
     */
    @Column(name = "message_kind", nullable = false, length = 30)
    private String messageKind = "ENCRYPTED";

    /** Server-side creation timestamp. */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /**
     * Soft-delete timestamp. {@code null} means the message is active.
     * Clients check this field and hide deleted messages from the UI.
     */
    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    /**
     * Timestamp of the last edit. {@code null} if the message has never been edited.
     * Clients display an "(edited)" label next to the timestamp.
     */
    @Column(name = "edited_at")
    private LocalDateTime editedAt;

    /**
     * Message version, starting at 1. Incremented on each edit.
     * Allows clients to discard stale WebSocket events.
     */
    @Column(name = "version", nullable = false)
    private Integer version = 1;

    /** Current delivery status. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MessageStatus status = MessageStatus.SENT;

    /**
     * Message delivery status.
     * Transitions are strictly one-directional: SENT → DELIVERED → READ.
     */
    public enum MessageStatus {
        /** Saved on the server but not yet delivered to the recipient's device. */
        SENT,
        /** Delivered to the recipient's device (the app received the envelope). */
        DELIVERED,
        /** The recipient opened the chat and saw the message. */
        READ
    }
}

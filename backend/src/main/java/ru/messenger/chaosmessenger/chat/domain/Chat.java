package ru.messenger.chaosmessenger.chat.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.List;

/**
 * A chat — the container for a conversation between two or more users.
 *
 * <p>Two chat types are supported:
 * <ul>
 *   <li>{@code DIRECT} — a private conversation between exactly two users.
 *       Created once and reused on subsequent requests.</li>
 *   <li>{@code GROUP} — a group chat with an arbitrary number of participants.
 *       Requires the {@link #name} field.</li>
 * </ul>
 *
 * <p>Messages are stored in {@link Message}; participants in {@link ChatParticipant}.
 * The chat itself stores only metadata, never encrypted content.
 */
@Entity
@Table(name = "chats")
@Getter
@Setter
public class Chat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Chat type: {@code "DIRECT"} or {@code "GROUP"}.
     */
    @Column(nullable = false)
    private String type;

    /**
     * Display name — set only for {@code GROUP} chats.
     * Always {@code null} for {@code DIRECT} chats; the name comes from the other user's profile.
     */
    @Column(name = "name", length = 100)
    private String name;

    /** Chat creation timestamp. */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /**
     * Lazily loaded participant list. Do not use directly in services —
     * prefer a separate query via {@code ChatParticipantRepository}
     * for batch-loading participants across multiple chats at once.
     */
    @OneToMany(mappedBy = "chatId", fetch = FetchType.LAZY)
    private List<ChatParticipant> participants;
}

package ru.messenger.chaosmessenger.message.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "message_reactions",
        uniqueConstraints = @UniqueConstraint(
                name = "uk_message_reactions_message_user_emoji",
                columnNames = {"message_id", "user_id", "emoji"}
        )
)
@Getter
@Setter
public class MessageReaction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "message_id", nullable = false)
    private Long messageId;

    @Column(name = "chat_id", nullable = false)
    private Long chatId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "emoji", nullable = false, length = 32)
    private String emoji;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
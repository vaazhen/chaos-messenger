package ru.messenger.chaosmessenger.chat.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import ru.messenger.chaosmessenger.user.domain.User;

@Entity
@Table(name = "chat_participants")
@Getter
@Setter
public class ChatParticipant {

    public ChatParticipant() {
    }

    public ChatParticipant(Long chatId, Long userId) {
        this.chatId = chatId;
        this.userId = userId;
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "chat_id", nullable = false)
    private Long chatId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "chat_id", insertable = false, updatable = false)
    private Chat chat;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", insertable = false, updatable = false)
    private User user;

}
package ru.messenger.chaosmessenger.message.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.messenger.chaosmessenger.message.domain.MessageReaction;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface MessageReactionRepository extends JpaRepository<MessageReaction, Long> {

    Optional<MessageReaction> findByMessageIdAndUserIdAndEmoji(Long messageId, Long userId, String emoji);

    List<MessageReaction> findByMessageId(Long messageId);

    List<MessageReaction> findByMessageIdIn(Collection<Long> messageIds);
}
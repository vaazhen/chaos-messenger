package ru.messenger.chaosmessenger.chat.repository;

import io.lettuce.core.dynamic.annotation.Param;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import ru.messenger.chaosmessenger.chat.domain.Chat;

import java.util.List;
import java.util.Optional;

public interface ChatRepository extends JpaRepository<Chat, Long> {

    List<Chat> findByIdIn(List<Long> ids);

    @Query("SELECT DISTINCT c FROM Chat c " +
            "LEFT JOIN FETCH c.participants p " +
            "LEFT JOIN FETCH p.user " +
            "WHERE c.id IN :ids")
    List<Chat> findByIdInWithParticipants(@Param("ids") List<Long> ids);

    @EntityGraph(attributePaths = {"participants", "participants.user"})
    Optional<Chat> findById(Long id);
}
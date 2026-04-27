package ru.messenger.chaosmessenger.chat.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.messenger.chaosmessenger.chat.domain.ChatParticipant;

import java.util.List;

public interface ChatParticipantRepository extends JpaRepository<ChatParticipant, Long> {

    List<ChatParticipant> findByUserId(Long userId);

    List<ChatParticipant> findByChatId(Long chatId);

    List<ChatParticipant> findByChatIdIn(List<Long> chatIds);

    boolean existsByChatIdAndUserId(Long chatId, Long userId);

    @org.springframework.data.jpa.repository.Query(value = """
            select c.id
            from chats c
            join chat_participants cp1 on cp1.chat_id = c.id
            join chat_participants cp2 on cp2.chat_id = c.id
            where c.type = 'DIRECT'
              and cp1.user_id = :userId1
              and cp2.user_id = :userId2
              and (
                  select count(*)
                  from chat_participants cp
                  where cp.chat_id = c.id
              ) = 2
            limit 1
            """, nativeQuery = true)
    java.util.Optional<Long> findDirectChatId(
            @org.springframework.data.repository.query.Param("userId1") Long u1,
            @org.springframework.data.repository.query.Param("userId2") Long u2
    );

    @org.springframework.data.jpa.repository.Query(value = """
            select c.id
            from chats c
            join chat_participants cp on cp.chat_id = c.id
            where c.type = 'SAVED'
              and cp.user_id = :userId
              and (
                  select count(*)
                  from chat_participants cp2
                  where cp2.chat_id = c.id
              ) = 1
            limit 1
            """, nativeQuery = true)
    java.util.Optional<Long> findSavedChatId(
            @org.springframework.data.repository.query.Param("userId") Long userId
    );

}
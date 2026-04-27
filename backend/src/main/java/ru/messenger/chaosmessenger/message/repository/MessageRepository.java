package ru.messenger.chaosmessenger.message.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ru.messenger.chaosmessenger.chat.domain.Message;

import java.util.List;
import java.util.Optional;

public interface MessageRepository extends JpaRepository<Message, Long> {
    List<Message> findByChatIdOrderByCreatedAtAsc(Long chatId);

    Optional<Message> findTopByChatIdOrderByCreatedAtDesc(Long chatId);

    Optional<Message> findByClientMessageId(String clientMessageId);

    @Query("select m from Message m where m.chatId in :chatIds and m.createdAt = (select max(m2.createdAt) from Message m2 where m2.chatId = m.chatId)")
    List<Message> findLatestByChatIds(@Param("chatIds") List<Long> chatIds);

    List<Message> findByChatIdAndSenderIdNot(Long chatId, Long senderId);

    @Query("select m from Message m where m.chatId = :chatId and m.senderId <> :senderId and m.status = :status")
    List<Message> findByChatIdAndSenderIdNotAndStatus(@Param("chatId") Long chatId,
                                                       @Param("senderId") Long senderId,
                                                       @Param("status") Message.MessageStatus status);

    @Query("select m from Message m where m.chatId = :chatId and (:beforeId is null or m.id < :beforeId) order by m.id desc")
    List<Message> findByChatIdBefore(@Param("chatId") Long chatId,
                                      @Param("beforeId") Long beforeId,
                                      Pageable pageable);

    @Modifying
    @Query("update Message m set m.status = :newStatus where m.chatId = :chatId and m.senderId <> :userId and m.status = :currentStatus")
    int bulkUpdateStatusForChat(@Param("chatId") Long chatId,
                                @Param("userId") Long userId,
                                @Param("currentStatus") Message.MessageStatus currentStatus,
                                @Param("newStatus") Message.MessageStatus newStatus);

    long countByChatId(Long chatId);
}

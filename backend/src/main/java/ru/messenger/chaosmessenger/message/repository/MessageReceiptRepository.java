package ru.messenger.chaosmessenger.message.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import ru.messenger.chaosmessenger.message.domain.MessageReceipt;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface MessageReceiptRepository extends JpaRepository<MessageReceipt, Long> {

    Optional<MessageReceipt> findByMessageIdAndUserIdAndDeviceId(Long messageId, Long userId, String deviceId);

    List<MessageReceipt> findByMessageId(Long messageId);

    List<MessageReceipt> findByMessageIdIn(Collection<Long> messageIds);

    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query(value = """
            insert into message_receipts (
                message_id,
                chat_id,
                user_id,
                device_id,
                delivered_at,
                read_at,
                created_at,
                updated_at
            )
            values (
                :messageId,
                :chatId,
                :userId,
                :deviceId,
                :now,
                null,
                :now,
                :now
            )
            on conflict (message_id, user_id, device_id)
            do update set
                delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at),
                updated_at = excluded.updated_at
            """, nativeQuery = true)
    int upsertDelivered(
            @Param("messageId") Long messageId,
            @Param("chatId") Long chatId,
            @Param("userId") Long userId,
            @Param("deviceId") String deviceId,
            @Param("now") LocalDateTime now
    );

    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query(value = """
            insert into message_receipts (
                message_id,
                chat_id,
                user_id,
                device_id,
                delivered_at,
                read_at,
                created_at,
                updated_at
            )
            values (
                :messageId,
                :chatId,
                :userId,
                :deviceId,
                :now,
                :now,
                :now,
                :now
            )
            on conflict (message_id, user_id, device_id)
            do update set
                delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at),
                read_at = coalesce(message_receipts.read_at, excluded.read_at),
                updated_at = excluded.updated_at
            """, nativeQuery = true)
    int upsertRead(
            @Param("messageId") Long messageId,
            @Param("chatId") Long chatId,
            @Param("userId") Long userId,
            @Param("deviceId") String deviceId,
            @Param("now") LocalDateTime now
    );
}
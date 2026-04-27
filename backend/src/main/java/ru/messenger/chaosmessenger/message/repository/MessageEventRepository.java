package ru.messenger.chaosmessenger.message.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.messenger.chaosmessenger.message.domain.MessageEvent;

public interface MessageEventRepository extends JpaRepository<MessageEvent, Long> {
}

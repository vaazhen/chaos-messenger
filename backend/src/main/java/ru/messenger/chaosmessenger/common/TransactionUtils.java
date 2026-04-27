package ru.messenger.chaosmessenger.common;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Utility for scheduling work to run <em>after</em> a transaction commits.
 *
 * <p>WebSocket fan-out inside an open transaction holds the DB connection
 * while STOMP messages are being dispatched. Under load this exhausts the
 * connection pool. Use {@code afterCommit} to defer all WS publishing until
 * the transaction is safely closed.
 *
 * <pre>{@code
 *   TransactionUtils.afterCommit(() ->
 *       messagingTemplate.convertAndSend("/topic/...", payload));
 * }</pre>
 *
 * <p>If called outside a transaction the runnable executes immediately.
 */
public final class TransactionUtils {

    private TransactionUtils() {}

    public static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}

package ru.messenger.chaosmessenger.common.exception;

/**
 * Thrown when a rate limit is exceeded.
 * Mapped to HTTP 429 Too Many Requests by GlobalExceptionHandler.
 */
public class RateLimitException extends RuntimeException {
    private final long retryAfterSeconds;

    public RateLimitException(String message, long retryAfterSeconds) {
        super(message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** Number of seconds the client should wait before retrying. */
    public long getRetryAfterSeconds() {
        return retryAfterSeconds;
    }
}

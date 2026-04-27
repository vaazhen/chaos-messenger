package ru.messenger.chaosmessenger.common.exception;

public class AuthException extends RuntimeException {
    public AuthException(String message) { super(message); }
    public AuthException(String message, Throwable cause) { super(message, cause); }
}

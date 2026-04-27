package ru.messenger.chaosmessenger.common.api;

import jakarta.validation.ConstraintViolationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.common.dto.ApiErrorResponse;
import ru.messenger.chaosmessenger.common.exception.AuthException;
import ru.messenger.chaosmessenger.common.exception.ChatException;
import ru.messenger.chaosmessenger.common.exception.CryptoException;
import ru.messenger.chaosmessenger.common.exception.MessageException;
import ru.messenger.chaosmessenger.common.exception.RateLimitException;

import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;

@ExtendWith(MockitoExtension.class)
class GlobalExceptionHandlerTest {

    @Mock MessageSource messageSource;

    private GlobalExceptionHandler handler;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler(messageSource);

        lenient().when(messageSource.getMessage(
                anyString(),
                any(),
                anyString(),
                any()
        )).thenAnswer(invocation -> invocation.getArgument(2));
    }

    @Test
    void handleNotFoundReturns404() {
        var response = handler.handleNotFound(new NoSuchElementException("missing"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        ApiErrorResponse body = Objects.requireNonNull(response.getBody());
        assertThat(body.getStatus()).isEqualTo(404);
        assertThat(body.getError()).isEqualTo("NOT_FOUND");
        assertThat(body.getMessage()).isEqualTo("Entity not found");
        assertThat(body.getTimestamp()).isNotNull();
    }

    @Test
    void handleBadRequestReturns400() {
        var response = handler.handleBadRequest(new IllegalArgumentException("bad"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("BAD_REQUEST");
        assertThat(response.getBody().getMessage()).isEqualTo("Bad request");
    }

    @Test
    void handleConflictReturns409() {
        var response = handler.handleConflict(new IllegalStateException("conflict"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("CONFLICT");
    }

    @Test
    void handleAuthReturns401WithOriginalMessage() {
        var response = handler.handleAuth(new AuthException("bad token"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("AUTH_ERROR");
        assertThat(response.getBody().getMessage()).isEqualTo("bad token");
    }

    @Test
    void handleRateLimitReturns429AndRetryAfterHeader() {
        var response = handler.handleRateLimit(new RateLimitException("too many", 33));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("33");
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("RATE_LIMIT_EXCEEDED");
        assertThat(response.getBody().getMessage()).isEqualTo("too many");
    }

    @Test
    void handleDomainExceptionsReturnExpectedStatuses() {
        var chat = handler.handleChatException(new ChatException("chat error"));
        var message = handler.handleMessageException(new MessageException("message error"));
        var crypto = handler.handleCryptoException(new CryptoException("crypto error"));

        assertThat(chat.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(Objects.requireNonNull(chat.getBody()).getError()).isEqualTo("CHAT_ERROR");

        assertThat(message.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(Objects.requireNonNull(message.getBody()).getError()).isEqualTo("MESSAGE_ERROR");

        assertThat(crypto.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(Objects.requireNonNull(crypto.getBody()).getError()).isEqualTo("CRYPTO_ERROR");
    }

    @Test
    void handleForbiddenReturns403() {
        var response = handler.handleForbidden(new AccessDeniedException("denied"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("FORBIDDEN");
        assertThat(response.getBody().getMessage()).isEqualTo("Access is denied");
    }

    @Test
    void handleConstraintViolationUsesFallbackWhenViolationSetIsEmpty() {
        var response = handler.handleConstraintViolation(new ConstraintViolationException(Set.of()));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("VALIDATION_ERROR");
        assertThat(response.getBody().getMessage()).isEqualTo("Validation failed");
    }

    @Test
    void handleResponseStatusUsesReasonWhenPresent() {
        var response = handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.CONFLICT, "username taken")
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(Objects.requireNonNull(response.getBody()).getStatus()).isEqualTo(409);
        assertThat(response.getBody().getError()).isEqualTo("CONFLICT");
        assertThat(response.getBody().getMessage()).isEqualTo("username taken");
    }

    @Test
    void handleResponseStatusUsesReasonPhraseWhenReasonIsBlank() {
        var response = handler.handleResponseStatus(
                new ResponseStatusException(HttpStatus.NOT_FOUND, " ")
        );

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(Objects.requireNonNull(response.getBody()).getMessage()).isEqualTo("Not Found");
    }

    @Test
    void handleOtherReturns500() {
        var response = handler.handleOther(new RuntimeException("boom"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(Objects.requireNonNull(response.getBody()).getError()).isEqualTo("INTERNAL_SERVER_ERROR");
        assertThat(response.getBody().getMessage()).isEqualTo("Internal server error");
    }
}
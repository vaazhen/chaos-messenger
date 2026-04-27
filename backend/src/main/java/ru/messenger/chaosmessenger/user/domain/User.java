package ru.messenger.chaosmessenger.user.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

/**
 * A system user.
 *
 * <p>Authentication is JWT-based. The password is stored as a bcrypt hash in {@link #passwordHash}.
 * SMS-code login is optionally supported via the {@link #phone} field.
 *
 * <p>Profile information ({@link #firstName}, {@link #lastName}, {@link #avatarUrl})
 * has no bearing on security and is visible to all participants in shared chats.
 *
 * <p>{@link #publicKey} is a legacy V1 migration field that predates per-device keys.
 * Current cryptography is handled entirely through {@code UserDevice}.
 */
@Entity
@Table(name = "users")
@Getter
@Setter
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Unique login name. Used as the principal in Spring Security. */
    @Column(nullable = false, unique = true, length = 100)
    private String username;

    /** Email address. Must be unique; used during registration. */
    @Column(nullable = false, unique = true)
    private String email;

    /** BCrypt password hash. Never exposed to the client. */
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    /**
     * Legacy field: global user public key from the V1 protocol.
     * Not used by current cryptography (superseded by per-device keys in {@code UserDevice}).
     * Retained for backwards compatibility.
     */
    @Column(name = "public_key", columnDefinition = "text")
    private String publicKey;

    /** Account status (ACTIVE, BANNED, etc.). */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status;

    /** Account registration timestamp. */
    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    /** Display name (legacy; superseded by firstName + lastName). */
    @Column(name = "display_name")
    private String displayName;

    /** First name for display in the user profile. */
    @Column(name = "first_name")
    private String firstName;

    /** Last name for display in the user profile. */
    @Column(name = "last_name")
    private String lastName;

    /** Avatar URL (stored as an external link). */
    @Column(name = "avatar_url", columnDefinition = "text")
    private String avatarUrl;

    /**
     * Phone number in E.164 format (e.g. {@code +79001234567}).
     * Unique. Used for SMS-code login.
     * {@code null} if the user has not linked a phone number.
     */
    @Column(name = "phone", unique = true)
    private String phone;

    /**
     * Timestamp of the last logout or connection loss.
     * Updated by {@code OnlineService.setOffline()}.
     * Shown in the UI as "last seen: ...".
     */
    @Column(name = "last_seen")
    private LocalDateTime lastSeen;
}

package ru.messenger.chaosmessenger.crypto.dto;

import lombok.Data;

@Data
public class MessageEnvelopeDto {

    private Long chatId;

    private String senderDeviceId;
    private String recipientDeviceId;

    /**
     * PREKEY_WHISPER | WHISPER
     */
    private String messageType;

    /**
     * Sender's identity public key.
     * Required by the recipient for the local X3DH session bootstrap.
     */
    private String senderIdentityPublicKey;

    /**
     * Initiator's ephemeral public key.
     * Required by the recipient for the local session bootstrap.
     */
    private String ephemeralPublicKey;

    /**
     * Encrypted message payload (Base64).
     */
    private String ciphertext;

    /**
     * AES-GCM nonce (Base64).
     */
    private String nonce;

    /**
     * Recipient's Signed PreKey ID used during session bootstrap.
     */
    private Integer signedPreKeyId;

    /**
     * Recipient's One-Time PreKey ID used during session bootstrap.
     * May be null.
     */
    private Integer oneTimePreKeyId;

    /**
     * Unix timestamp in milliseconds.
     */
    private Long timestamp;
}
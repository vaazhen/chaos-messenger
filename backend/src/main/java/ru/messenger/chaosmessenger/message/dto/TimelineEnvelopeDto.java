package ru.messenger.chaosmessenger.message.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class TimelineEnvelopeDto {
    private String targetDeviceId;
    private String messageType;
    private String senderIdentityPublicKey;
    private String ephemeralPublicKey;
    private String ciphertext;
    private String nonce;
    private Integer signedPreKeyId;
    private Integer oneTimePreKeyId;

    // Sequential index of this message within the ratchet session.
    // The client uses it to synchronise the receiving chain.
    private Integer messageIndex;
}

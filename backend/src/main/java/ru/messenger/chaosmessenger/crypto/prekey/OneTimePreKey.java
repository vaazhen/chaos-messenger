package ru.messenger.chaosmessenger.crypto.prekey;

import jakarta.persistence.*;
import lombok.*;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "one_time_prekeys",
        uniqueConstraints = @UniqueConstraint(columnNames = {"device_db_id", "prekey_id"})
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OneTimePreKey {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "device_db_id", nullable = false)
    private UserDevice device;

    @Column(name = "prekey_id", nullable = false)
    private Integer preKeyId;

    @Column(name = "public_key", nullable = false, columnDefinition = "TEXT")
    private String publicKey;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;

    public boolean isUsed() {
        return usedAt != null;
    }
}
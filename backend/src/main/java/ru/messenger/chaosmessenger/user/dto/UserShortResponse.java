package ru.messenger.chaosmessenger.user.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class UserShortResponse {
    private Long id;
    private String username;
}
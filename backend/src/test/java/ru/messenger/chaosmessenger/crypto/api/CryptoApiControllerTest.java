package ru.messenger.chaosmessenger.crypto.api;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import ru.messenger.chaosmessenger.auth.service.DeviceRegistrationTokenService;
import ru.messenger.chaosmessenger.crypto.device.CurrentDeviceService;
import ru.messenger.chaosmessenger.crypto.device.DeviceService;
import ru.messenger.chaosmessenger.crypto.device.UserDevice;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationRequest;
import ru.messenger.chaosmessenger.crypto.dto.DeviceRegistrationResponse;
import ru.messenger.chaosmessenger.crypto.dto.PreKeyBundleResponse;
import ru.messenger.chaosmessenger.crypto.dto.ResolvedChatDevicesResponse;
import ru.messenger.chaosmessenger.crypto.dto.UserDeviceResponse;
import ru.messenger.chaosmessenger.crypto.prekey.PreKeyService;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CryptoApiControllerTest {

    @Mock DeviceService deviceService;
    @Mock DeviceRegistrationTokenService deviceRegTokenService;
    @Mock PreKeyService preKeyService;
    @Mock CurrentDeviceService currentDeviceService;
    @Mock Authentication authentication;

    @InjectMocks DeviceController deviceController;
    @InjectMocks BundleController bundleController;

    @Test
    void registerRejectsMissingDeviceRegistrationToken() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest();

        assertThatThrownBy(() -> deviceController.register(" ", request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void registerRejectsInvalidDeviceRegistrationToken() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest();

        when(deviceRegTokenService.consumeAndGetUsername("bad-token")).thenReturn(null);

        assertThatThrownBy(() -> deviceController.register("bad-token", request))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void registerConsumesTokenAndDelegatesToDeviceService() {
        DeviceRegistrationRequest request = new DeviceRegistrationRequest();
        DeviceRegistrationResponse expected = DeviceRegistrationResponse.builder()
                .deviceId("dev-a")
                .serverDeviceInternalId(10L)
                .build();

        when(deviceRegTokenService.consumeAndGetUsername("device-token")).thenReturn("alice");
        when(deviceService.registerDevice("alice", request)).thenReturn(expected);

        DeviceRegistrationResponse response = deviceController.register("device-token", request);

        assertThat(response).isSameAs(expected);
        verify(deviceRegTokenService).consumeAndGetUsername("device-token");
        verify(deviceService).registerDevice("alice", request);
    }

    @Test
    void currentRejectsMissingAuthentication() {
        assertThatThrownBy(() -> deviceController.current(null, "dev-a"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void currentRejectsBlankDeviceId() {
        when(authentication.getName()).thenReturn("alice");

        assertThatThrownBy(() -> deviceController.current(authentication, " "))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void currentRejectsUnregisteredDevice() {
        when(authentication.getName()).thenReturn("alice");
        when(deviceService.findCurrentDevice("alice", "dev-a")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> deviceController.current(authentication, "dev-a"))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void currentReturnsRegisteredDevice() {
        DeviceRegistrationResponse expected = DeviceRegistrationResponse.builder()
                .deviceId("dev-a")
                .serverDeviceInternalId(10L)
                .build();

        when(authentication.getName()).thenReturn("alice");
        when(deviceService.findCurrentDevice("alice", "dev-a")).thenReturn(Optional.of(expected));

        DeviceRegistrationResponse response = deviceController.current(authentication, "dev-a");

        assertThat(response).isSameAs(expected);
        verify(deviceService).findCurrentDevice("alice", "dev-a");
    }

    @Test
    void myDevicesDelegatesToService() {
        UserDeviceResponse device = new UserDeviceResponse(
                10L,
                "dev-a",
                "Chrome",
                true,
                true,
                LocalDateTime.now(),
                LocalDateTime.now()
        );

        when(authentication.getName()).thenReturn("alice");
        when(deviceService.listMyDevices("alice", "dev-a")).thenReturn(List.of(device));

        List<UserDeviceResponse> response = deviceController.myDevices(authentication, "dev-a");

        assertThat(response).containsExactly(device);
        verify(deviceService).listMyDevices("alice", "dev-a");
    }

    @Test
    void deactivateDelegatesToService() {
        UserDeviceResponse expected = new UserDeviceResponse(
                10L,
                "dev-a",
                "Chrome",
                false,
                true,
                LocalDateTime.now(),
                LocalDateTime.now()
        );

        when(authentication.getName()).thenReturn("alice");
        when(deviceService.deactivateDevice("alice", 10L, true, "dev-a")).thenReturn(expected);

        UserDeviceResponse response = deviceController.deactivateDevice(10L, true, authentication, "dev-a");

        assertThat(response).isSameAs(expected);
        verify(deviceService).deactivateDevice("alice", 10L, true, "dev-a");
    }

    @Test
    void getBundleRequiresCurrentDeviceAndDelegatesToPreKeyService() {
        PreKeyBundleResponse expected = PreKeyBundleResponse.builder()
                .username("bob")
                .devices(List.of())
                .build();

        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(preKeyService.getBundleByUsername("bob")).thenReturn(expected);

        PreKeyBundleResponse response = bundleController.getBundle("bob", authentication);

        assertThat(response).isSameAs(expected);
        verify(currentDeviceService).requireCurrentDevice();
        verify(preKeyService).getBundleByUsername("bob");
    }

    @Test
    void resolveChatDevicesRequiresCurrentDeviceAndDelegatesToPreKeyService() {
        ResolvedChatDevicesResponse expected = ResolvedChatDevicesResponse.builder()
                .chatId(100L)
                .username("alice")
                .currentDeviceId("dev-a")
                .targetDevices(List.of())
                .build();

        when(authentication.getName()).thenReturn("alice");
        when(currentDeviceService.requireCurrentDevice()).thenReturn(new UserDevice());
        when(preKeyService.resolveChatDevices("alice", 100L)).thenReturn(expected);

        ResolvedChatDevicesResponse response = bundleController.resolveChatDevices(100L, authentication);

        assertThat(response).isSameAs(expected);
        verify(currentDeviceService).requireCurrentDevice();
        verify(preKeyService).resolveChatDevices("alice", 100L);
    }
}
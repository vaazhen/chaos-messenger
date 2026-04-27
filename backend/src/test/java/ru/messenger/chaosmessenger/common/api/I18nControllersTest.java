package ru.messenger.chaosmessenger.common.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.web.servlet.LocaleResolver;

import java.util.Locale;
import java.util.Objects;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class I18nControllersTest {

    @Mock LocaleResolver localeResolver;
    @Mock HttpServletRequest request;
    @Mock HttpServletResponse response;

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void i18nChangeLocaleStoresRequestedLanguage() {
        I18nController controller = new I18nController(localeResolver);

        var result = controller.changeLocale("ru", request, response);

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();

        ArgumentCaptor<Locale> localeCaptor = ArgumentCaptor.forClass(Locale.class);
        verify(localeResolver).setLocale(
                org.mockito.ArgumentMatchers.same(request),
                org.mockito.ArgumentMatchers.same(response),
                localeCaptor.capture()
        );
        assertThat(localeCaptor.getValue().toLanguageTag()).isEqualTo("ru");
    }

    @Test
    void i18nCurrentLocaleReturnsResolvedLocale() {
        I18nController controller = new I18nController(localeResolver);

        when(localeResolver.resolveLocale(request)).thenReturn(Locale.forLanguageTag("ru"));

        var result = controller.currentLocale(request);

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(result.getBody()).isEqualTo("ru");
    }

    @Test
    void i18nAvailableReturnsSupportedLanguages() {
        I18nController controller = new I18nController(localeResolver);

        var result = controller.available();

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(Objects.requireNonNull(result.getBody()))
                .anySatisfy(lang -> assertThat(lang).containsEntry("code", "en").containsEntry("label", "English"))
                .anySatisfy(lang -> assertThat(lang).containsEntry("code", "ru").containsEntry("label", "Russian"));
    }

    @Test
    void languageControllerStoresRussianWhenLangIsRu() {
        LanguageController controller = new LanguageController(localeResolver);

        var result = controller.setLanguage("RU", request, response);

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();

        ArgumentCaptor<Locale> localeCaptor = ArgumentCaptor.forClass(Locale.class);
        verify(localeResolver).setLocale(
                org.mockito.ArgumentMatchers.same(request),
                org.mockito.ArgumentMatchers.same(response),
                localeCaptor.capture()
        );
        assertThat(localeCaptor.getValue().getLanguage()).isEqualTo("ru");
    }

    @Test
    void languageControllerFallsBackToEnglishForUnsupportedLang() {
        LanguageController controller = new LanguageController(localeResolver);

        var result = controller.setLanguage("de", request, response);

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();

        ArgumentCaptor<Locale> localeCaptor = ArgumentCaptor.forClass(Locale.class);
        verify(localeResolver).setLocale(
                org.mockito.ArgumentMatchers.same(request),
                org.mockito.ArgumentMatchers.same(response),
                localeCaptor.capture()
        );
        assertThat(localeCaptor.getValue()).isEqualTo(Locale.ENGLISH);
    }

    @Test
    void translationsControllerLoadsEnglishMessagesByExplicitLang() throws Exception {
        TranslationsController controller = new TranslationsController();

        var result = controller.getMessages("en");

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(Objects.requireNonNull(result.getBody())).isNotEmpty();
    }

    @Test
    void translationsControllerLoadsRussianMessagesByExplicitLang() throws Exception {
        TranslationsController controller = new TranslationsController();

        var result = controller.getMessages("ru");

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(Objects.requireNonNull(result.getBody())).isNotEmpty();
    }

    @Test
    void translationsControllerUsesLocaleContextWhenLangIsBlank() throws Exception {
        TranslationsController controller = new TranslationsController();
        LocaleContextHolder.setLocale(Locale.forLanguageTag("ru"));

        var result = controller.getMessages(" ");

        assertThat(result.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(Objects.requireNonNull(result.getBody())).isNotEmpty();
    }
}
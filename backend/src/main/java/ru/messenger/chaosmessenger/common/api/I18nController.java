package ru.messenger.chaosmessenger.common.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.LocaleResolver;

import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/api/i18n")
@RequiredArgsConstructor
public class I18nController {

    private final LocaleResolver localeResolver;

    @PostMapping("/locale")
    public ResponseEntity<Void> changeLocale(@RequestParam("lang") String lang, HttpServletRequest request, HttpServletResponse response) {
        Locale locale = Locale.forLanguageTag(lang);
        localeResolver.setLocale(request, response, locale);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/locale")
    public ResponseEntity<String> currentLocale(HttpServletRequest request) {
        Locale locale = localeResolver.resolveLocale(request);
        return ResponseEntity.ok(locale.toLanguageTag());
    }

    @GetMapping("/available")
    public ResponseEntity<List<Map<String,String>>> available() {
        List<Map<String,String>> langs = List.of(
                Map.of("code", "en", "label", "English"),
                Map.of("code", "ru", "label", "Russian")
        );
        return ResponseEntity.ok(langs);
    }
}

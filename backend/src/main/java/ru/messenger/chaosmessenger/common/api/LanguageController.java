package ru.messenger.chaosmessenger.common.api;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.LocaleResolver;


import java.util.Locale;

@RestController
@RequestMapping("/api/v1/i18n")
public class LanguageController {

private final LocaleResolver localeResolver;

public LanguageController(LocaleResolver localeResolver) {
        this.localeResolver = localeResolver;
    }

@PostMapping("/lang")
    public ResponseEntity<Void> setLanguage(@RequestParam("lang") String lang,
                                            HttpServletRequest request,
                                            HttpServletResponse response) {
        Locale locale = "ru".equalsIgnoreCase(lang) ? new Locale("ru") : Locale.ENGLISH;
        localeResolver.setLocale(request, response, locale);
        return ResponseEntity.ok().build();
    }
}

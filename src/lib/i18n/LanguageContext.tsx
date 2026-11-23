"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import enTranslations from "./translations/en.json";
import htTranslations from "./translations/ht.json";
import frTranslations from "./translations/fr.json";
import esTranslations from "./translations/es.json";

export type Language = "en" | "ht" | "fr" | "es";

export const languages = {
  en: { code: "en", name: "English", flag: "🇺🇸" },
  ht: { code: "ht", name: "Kreyòl Ayisyen", flag: "🇭🇹" },
  fr: { code: "fr", name: "Français", flag: "🇫🇷" },
  es: { code: "es", name: "Español", flag: "🇪🇸" },
};

const translations = {
  en: enTranslations,
  ht: htTranslations,
  fr: frTranslations,
  es: esTranslations,
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  // Load language from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("language") as Language;
      if (saved && translations[saved]) {
        setLanguageState(saved);
      }
    }
  }, []);

  // Save language to localStorage when it changes
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      localStorage.setItem("language", lang);
    }
  };

  // Translation function. When the active locale has no string for the
  // key, fall back to the English string instead of leaking the raw key
  // to users (F-M10); the raw key is only returned when English is
  // missing the key too.
  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split(".");

    const lookup = (dict: unknown): unknown => {
      let value: any = dict;
      for (const k of keys) {
        value = value?.[k];
        if (value === undefined) break;
      }
      return value;
    };

    let value = lookup(translations[language]);
    if (typeof value !== "string" && language !== "en") {
      value = lookup(translations.en);
    }

    if (typeof value !== "string") {
      console.warn(`Translation missing for key: ${key}`, { language, value });
      return key;
    }

    // Replace parameters
    if (params) {
      return Object.entries(params).reduce((str, [key, val]) => {
        return str.replace(`{${key}}`, String(val));
      }, value);
    }

    return value;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

// Alias for compatibility
export const useTranslation = useLanguage;

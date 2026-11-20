/**
 * Cluster 6 pins — i18n t() English fallback (F-M10).
 *
 * es/fr/ht are each missing 166 keys that exist in en (the whole
 * dashboard/team/balance/webhooks sections plus parts of api/customer/
 * pricing). Before this fix, t() returned the raw key string for those
 * (a French user saw "dashboard.title"); now the English string is
 * rendered instead. A key missing in English too still returns the
 * raw key as the last resort.
 *
 * Pins run through the real LanguageProvider/useLanguage surface:
 * they fail on pristine sandbox (raw key returned) and pass on this
 * branch. Controls (existing locale strings, param substitution,
 * English active locale, missing-everywhere keys) pass on both.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  LanguageProvider,
  useLanguage,
  type Language,
} from "../i18n/LanguageContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("LanguageContext t() fallback (Cluster 6, F-M10)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (root) {
      const r = root;
      act(() => r.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    localStorage.clear();
    warnSpy.mockRestore();
  });

  function renderTranslator(language: Language) {
    localStorage.setItem("language", language);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let api: ReturnType<typeof useLanguage> | undefined;
    function Probe() {
      api = useLanguage();
      return null;
    }
    const r = root;
    act(() => {
      r.render(
        <LanguageProvider>
          <Probe />
        </LanguageProvider>,
      );
    });
    if (!api) throw new Error("probe did not capture the language context");
    return api;
  }

  describe("pins: keys missing in the active locale fall back to English", () => {
    it.each(["fr", "es", "ht"] as Language[])(
      "dashboard.title renders the English string in %s",
      (lang) => {
        const { t } = renderTranslator(lang);
        expect(t("dashboard.title")).toBe("Dashboard");
      },
    );

    it.each(["fr", "es", "ht"] as Language[])(
      "team.title renders the English string in %s",
      (lang) => {
        const { t } = renderTranslator(lang);
        expect(t("team.title")).toBe("Team Members");
      },
    );

    it.each(["fr", "es", "ht"] as Language[])(
      "balance.amount renders the English string in %s",
      (lang) => {
        const { t } = renderTranslator(lang);
        expect(t("balance.amount")).toBe("Amount");
      },
    );

    it("webhooks section keys fall back to English in fr", () => {
      const { t } = renderTranslator("fr");
      const result = t("webhooks.logs.title");
      expect(result).not.toBe("webhooks.logs.title");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("controls: behavior that must not change", () => {
    it("existing locale strings are returned unchanged", () => {
      expect(renderTranslator("fr").t("common.loading")).toBe("Chargement...");
      expect(renderTranslator("es").t("common.loading")).toBe("Cargando...");
      expect(renderTranslator("ht").t("common.loading")).toBe("Chaje...");
    });

    it("param substitution still applies to locale strings", () => {
      const { t } = renderTranslator("fr");
      expect(t("storefront.sendingTo", { phone: "+50937000000" })).toBe(
        "Vous êtes sur le point d'envoyer une recharge à +50937000000",
      );
    });

    it("English active locale resolves its own strings", () => {
      const { t } = renderTranslator("en");
      expect(t("dashboard.title")).toBe("Dashboard");
      expect(t("common.loading")).toBe("Loading...");
    });

    it("a key missing in English too still returns the raw key", () => {
      expect(renderTranslator("fr").t("this.key.does.not.exist")).toBe(
        "this.key.does.not.exist",
      );
      expect(renderTranslator("en").t("this.key.does.not.exist")).toBe(
        "this.key.does.not.exist",
      );
    });
  });
});

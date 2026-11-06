"use client";
import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { LANGUAGES, isLanguage } from "@drycare/shared";
import { chooseLanguage, currentLanguage, startI18n } from "@/lib/i18n";

/** Starts translation once the page is live. */
export function I18nRoot() {
  useEffect(() => {
    void startI18n();
  }, []);
  return null;
}

/** A language picker. The names stay in their own language, so anyone can find theirs. */
export function LanguagePicker({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const [value, setValue] = useState("en");
  useEffect(() => setValue(currentLanguage()), []);
  return (
    <label className={className} data-i18n-skip="" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tone === "dark" ? "#e2e8f0" : "inherit" }}>
      <Globe aria-hidden="true" size={16} />
      <span className="sr-only">Language</span>
      <select
        aria-label="Language"
        value={value}
        onChange={(event) => { if (isLanguage(event.target.value)) chooseLanguage(event.target.value); }}
        style={{ background: "transparent", border: 0, color: "inherit", font: "inherit", fontSize: 14, cursor: "pointer", maxWidth: 110 }}
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} style={{ color: "#151514" }}>{l.name}</option>)}
      </select>
    </label>
  );
}

"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { Lang } from "../lib/i18n";

type UISettings = {
  colorScheme: "light" | "dark";
  setColorScheme: (v: "light" | "dark") => void;
  lang: Lang;
  setLang: (v: Lang) => void;
};

const UIContext = createContext<UISettings>({
  colorScheme: "dark",
  setColorScheme: () => undefined,
  lang: "ru",
  setLang: () => undefined,
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("dark");
  const [lang, setLang] = useState<Lang>("ru");

  const value = useMemo(
    () => ({ colorScheme, setColorScheme, lang, setLang }),
    [colorScheme, lang],
  );

  useEffect(() => {
    const storedScheme = typeof window !== "undefined" ? localStorage.getItem("ui-color-scheme") : null;
    if (storedScheme === "light" || storedScheme === "dark") setColorScheme(storedScheme);
    const storedLang = typeof window !== "undefined" ? localStorage.getItem("ui-lang") : null;
    if (storedLang === "ru" || storedLang === "en") setLang(storedLang);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ui-color-scheme", colorScheme);
      localStorage.setItem("ui-lang", lang);
    }
  }, [colorScheme, lang]);

  return (
    <UIContext.Provider value={value}>
      <MantineProvider defaultColorScheme={colorScheme} forceColorScheme={colorScheme}>
        <Notifications position="top-right" />
        {children}
      </MantineProvider>
    </UIContext.Provider>
  );
}

export function useUISettings() {
  return useContext(UIContext);
}

import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../types";

export function useTheme(theme: AppSettings["theme"]) {
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(media.matches);
    const listener = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const effectiveTheme = useMemo(() => {
    return theme === "auto" ? (systemPrefersDark ? "dark" : "light") : theme;
  }, [theme, systemPrefersDark]);

  useEffect(() => {
    if (effectiveTheme === "dark") {
      document.documentElement.classList.add("theme-dark");
    } else {
      document.documentElement.classList.remove("theme-dark");
    }
  }, [effectiveTheme]);

  return { systemPrefersDark, effectiveTheme };
}

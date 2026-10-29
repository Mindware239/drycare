"use client";
import { useEffect } from "react";

/**
 * Registers the service worker so Android can install DryCare as an app. Browsers only allow this on
 * HTTPS (or localhost); on the shop Wi-Fi over plain HTTP staff can still add a home-screen shortcut.
 * Skipped inside the Windows desktop app, which is already an app.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext || navigator.userAgent.includes("Electron")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

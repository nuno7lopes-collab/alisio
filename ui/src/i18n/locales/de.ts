import type { TranslationMap } from "../lib/types.ts";

export const de: TranslationMap = {
  common: {
    version: "Version",
    health: "Status",
    ok: "OK",
    online: "Online",
    offline: "Offline",
    connect: "Verbinden",
    refresh: "Aktualisieren",
    enabled: "Aktiviert",
    disabled: "Deaktiviert",
    na: "k. A.",
    docs: "Dokumentation",
    resources: "Ressourcen",
  },
  nav: {
    chat: "Chat",
    control: "Steuerung",
    agent: "Agent",
    settings: "Einstellungen",
    expand: "Seitenleiste ausklappen",
    collapse: "Seitenleiste einklappen",
  },
  tabs: {
    agents: "Agenten",
    home: "Start",
    authentications: "Authentifizierungen",
    organization: "Organisation",
    sessions: "Sitzungen",
    automations: "Automationen",
    chat: "Chat",
    tasks: "Aufgaben",
    settings: "Einstellungen",
  },
  subtitles: {
    agents: "Agent-Arbeitsbereiche, Tools und Identitäten verwalten.",
    home: "Persönlicher Agent, Fokus und Systemstatus.",
    authentications: "Verbundene Konten und Runtime-Zugriff.",
    organization: "Workspace-Systeme, Kanäle und Zustellungsgesundheit.",
    sessions: "Aktive Sitzungen inspizieren und Standardeinstellungen pro Sitzung anpassen.",
    automations: "Aufweckzeiten und wiederkehrende Agent-Läufe planen.",
    chat: "Direkte Alisio-Chat-Sitzung für schnelle Eingriffe.",
    tasks: "Hintergrundläufe, Zustellung und Operator-Nachverfolgung in einer Ansicht.",
    settings: "Workspace-Konfiguration, native Shell und Diagnose.",
  },
  overview: {
    access: {
      title: "Workspace-Zugang",
      subtitle: "Wo sich das Dashboard verbindet und wie es sich authentifiziert.",
      wsUrl: "WebSocket-URL",
      token: "Zugriffstoken",
      password: "Passwort (nicht gespeichert)", // pragma: allowlist secret
      sessionKey: "Standard-Sitzungsschlüssel",
      language: "Sprache",
      connectHint: "Klicken Sie auf Verbinden, um Verbindungsänderungen anzuwenden.",
      trustedProxy: "Authentifiziert über vertrauenswürdigen Proxy.",
    },
    snapshot: {
      title: "Snapshot",
      subtitle: "Neueste Workspace-Handshake-Informationen.",
      status: "Status",
      uptime: "Betriebszeit",
      tickInterval: "Tick-Intervall",
      lastChannelsRefresh: "Letzte Kanalaktualisierung",
      channelsHint:
        "Verwenden Sie Kanäle, um WhatsApp, Telegram, Discord, Signal oder iMessage zu verknüpfen.",
    },
    stats: {
      instances: "Instanzen",
      instancesHint: "Präsenzsignale in den letzten 5 Minuten.",
      sessions: "Sitzungen",
      sessionsHint: "Letzte von diesem Workspace verfolgte Sitzungsschlüssel.",
      cron: "Cron",
      cronNext: "Nächste Ausführung {time}",
    },
    notes: {
      title: "Notizen",
      subtitle: "Kurze Hinweise für Remote-Steuerung.",
      tailscaleTitle: "Tailscale Serve",
      tailscaleText:
        "Bevorzugen Sie den Serve-Modus, um Alisio auf Loopback mit Tailnet-Auth zu halten.",
      sessionTitle: "Sitzungshygiene",
      sessionText: "Verwenden Sie /new oder sessions.patch, um den Kontext zurückzusetzen.",
      cronTitle: "Cron-Erinnerungen",
      cronText: "Verwenden Sie isolierte Sitzungen für wiederkehrende Läufe.",
    },
    auth: {
      required:
        "Dieser Workspace erfordert Authentifizierung. Fügen Sie ein Token oder Passwort hinzu und klicken Sie auf Verbinden.",
      failed:
        "Authentifizierung fehlgeschlagen. Kopieren Sie erneut eine URL mit Token über {command}, oder aktualisieren Sie das Token und klicken Sie auf Verbinden.",
    },
    pairing: {
      hint: "Dieses Gerät benötigt eine Pairing-Freigabe vom Alisio-Host.",
      mobileHint:
        "Auf dem Mobilgerät? Kopieren Sie die vollständige URL (einschließlich #token=...) aus der Alisio-Desktop-App auf Ihrem Desktop.",
    },
    insecure: {
      hint: "Diese Seite ist HTTP, daher blockiert der Browser die Geräteidentifikation. Verwenden Sie HTTPS (Tailscale Serve) oder öffnen Sie {url} auf dem Alisio-Host.",
      stayHttp: "Wenn Sie bei HTTP bleiben müssen, setzen Sie {config} (nur Token).",
    },
  },
  chat: {
    disconnected: "Verbindung zu Alisio getrennt.",
    refreshTitle: "Chat-Daten aktualisieren",
    thinkingToggle: "Ausgabe des Assistenten ein-/ausblenden",
    focusToggle: "Fokusmodus ein-/ausschalten (Seitenleiste + Kopfzeile ausblenden)",
    hideCronSessions: "Cron-Sitzungen ausblenden",
    showCronSessions: "Cron-Sitzungen anzeigen",
    showCronSessionsHidden: "Cron-Sitzungen anzeigen ({count} ausgeblendet)",
    onboardingDisabled: "Während der Einrichtung deaktiviert",
  },
  languages: {
    en: "English",
    zhCN: "简体中文 (Vereinfachtes Chinesisch)",
    zhTW: "繁體中文 (Traditionelles Chinesisch)",
    ptBR: "Português (Brasilianisches Portugiesisch)",
    de: "Deutsch",
    es: "Spanisch (Español)",
  },
};

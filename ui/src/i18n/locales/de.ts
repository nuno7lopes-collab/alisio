import { mergeTranslationMaps } from "../lib/merge.ts";
import type { TranslationMap } from "../lib/types.ts";
import { en } from "./en.ts";

export const de: TranslationMap = mergeTranslationMaps(en, {
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
    cron: "Cron",
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
    cron: "Geplante Jobs, Läufe und Zustellung in einem Arbeitsbereich.",
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
    renameConversationFailed: "Chat konnte nicht umbenannt werden: {error}",
    localModelsSubagentOnly: "Lokale Modelle sind nur für Subagent-Sitzungen verfügbar.",
    setModelFailed: "Modell konnte nicht gesetzt werden: {error}",
    configDraftRequired:
      "Speichern oder laden Sie den Konfigurationsentwurf neu, bevor Sie das Standardmodell ändern.",
    configHashMissing: "Konfigurations-Hash fehlt. Neu laden und erneut versuchen.",
    setDefaultModelFailed: "Standardmodell konnte nicht gesetzt werden: {error}",
    focusToggle: "Fokusmodus ein-/ausschalten (Seitenleiste + Kopfzeile ausblenden)",
    hideCronSessions: "Cron-Sitzungen ausblenden",
    showCronSessions: "Cron-Sitzungen anzeigen",
    showCronSessionsHidden: "Cron-Sitzungen anzeigen ({count} ausgeblendet)",
    onboardingDisabled: "Während der Einrichtung deaktiviert",
  },
  alisio: {
    chat: {
      defaultAssistantName: "Assistent",
      participants: {
        you: "Du",
        tool: "Werkzeug",
      },
      browserPane: {
        title: "Aktivitätsbereich",
        surfacePicker: "Bereichsansicht",
        close: "Bereich schließen",
        viewRawText: "Rohtext anzeigen",
        noContent: "Kein Inhalt verfügbar",
        unavailable: "Keine Bereichsansicht verfügbar",
        surfaces: {
          preview: "Vorschau",
          computer: "Live-Sitzung",
          tool_output: "Tool-Ausgabe",
        },
      },
      loadingStates: {
        connecting: {
          eyebrow: "Verbinden",
          title: "Verbindung zum Workspace wird aufgebaut",
          body: "Die Runtime-Verbindung wird geöffnet, bevor dieser Chat geladen wird.",
        },
        bootstrap: {
          eyebrow: "Bootstrap",
          title: "Chat wird vorbereitet",
          body: "Der anfängliche Workspace-Status wird synchronisiert, bevor die Sitzung angezeigt wird.",
        },
        history: {
          eyebrow: "Verlauf",
          title: "Sitzungsverlauf wird geladen",
          body: "Die neuesten Nachrichten und Tool-Aktivitäten für diese Sitzung werden geladen.",
        },
        runStart: {
          eyebrow: "Cold start",
          title: "Ausführung wird gestartet",
          body: "Die Remote-Runtime wärmt sich auf und bereitet die Tool-Ausführung vor.",
        },
      },
      attachments: {
        imageAlt: "Angehängtes Bild",
      },
      taskProposals: {
        kind: {
          task: "Aufgabenvorschlag",
          project: "Projektvorschlag",
        },
        decision: {
          draft: "Entwurf",
          pending: "Ausstehend",
          approved: "Genehmigt",
          rejected: "Abgelehnt",
        },
        linkedTask: "Verknüpfte Aufgabe: {status} · {runtime} · {taskId}",
        launchedRun: "Gestarteter Lauf: {runId}",
        saveToInbox: "Im Postfach speichern",
        approve: "Genehmigen",
        reject: "Ablehnen",
        launch: "Starten",
        openLaunchedChat: "Gestarteten Chat öffnen",
        openTasks: "Aufgaben öffnen",
      },
    },
  },
  languages: {
    en: "English",
    zhCN: "简体中文 (Vereinfachtes Chinesisch)",
    zhTW: "繁體中文 (Traditionelles Chinesisch)",
    ptBR: "Português (Brasilianisches Portugiesisch)",
    de: "Deutsch",
    es: "Spanisch (Español)",
  },
});

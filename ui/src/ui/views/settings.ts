import { html, nothing } from "lit";
import type { SettingsSection } from "../navigation.ts";
import type { NativeShellPermission, NativeShellState } from "../types.ts";

const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  workspace: "Workspace",
  communications: "Communications",
  appearance: "Appearance",
  automation: "Automation",
  infrastructure: "Infrastructure",
  aiAgents: "AI & Agents",
  mac: "Mac",
  debug: "Debug",
  logs: "Logs",
};

const PERMISSION_LABELS: Record<NativeShellPermission, string> = {
  notifications: "Notifications",
  appleScript: "Automation",
  accessibility: "Accessibility",
  screenRecording: "Screen Recording",
  microphone: "Microphone",
  speechRecognition: "Speech Recognition",
  camera: "Camera",
  location: "Location",
};

function renderMacSection(props: {
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  onRefreshNative: () => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onRequestPermission: (permission: NativeShellPermission) => void;
  onSetVoiceWake: (params: { enabled?: boolean; talkEnabled?: boolean }) => void;
  onOpenNativeSettings: () => void;
  onRevealLogs: () => void;
}) {
  if (props.nativeShellLoading) {
    return html`<div class="card"><div class="card-sub">Loading native shell state…</div></div>`;
  }

  if (props.nativeShellError) {
    return html`
      <div class="card">
        <div class="card-title">Mac Shell</div>
        <div class="callout danger" style="margin-top: 16px;">${props.nativeShellError}</div>
      </div>
    `;
  }

  if (!props.nativeShellState) {
    return html`
      <div class="card">
        <div class="card-title">Mac Shell</div>
        <div class="card-sub">Available only inside the native Lume macOS app.</div>
      </div>
    `;
  }

  const state = props.nativeShellState;
  return html`
    <div class="card">
      <div class="card-title">Mac Shell</div>
      <div class="card-sub">
        Native controls exposed through the explicit
        <code>window.lumeHost</code>
        bridge.
      </div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Launch at Login</div>
          <div>${state.launchAtLogin ? "Enabled" : "Disabled"}</div>
          <div class="row" style="margin-top: 10px;">
            <button class="btn" @click=${() => props.onSetLaunchAtLogin(!state.launchAtLogin)}>
              ${state.launchAtLogin ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Voice Wake</div>
          <div>${state.voiceWake.enabled ? "Listening" : "Off"}</div>
          <div class="agent-kv-sub">
            ${state.voiceWake.supported
              ? `Talk mode ${state.voiceWake.talkEnabled ? "enabled" : "disabled"}`
              : "Not supported on this build"}
          </div>
          ${state.voiceWake.supported
            ? html`
                <div class="row" style="margin-top: 10px;">
                  <button
                    class="btn"
                    @click=${() => props.onSetVoiceWake({ enabled: !state.voiceWake.enabled })}
                  >
                    ${state.voiceWake.enabled ? "Disable Wake" : "Enable Wake"}
                  </button>
                  <button
                    class="btn"
                    @click=${() =>
                      props.onSetVoiceWake({ talkEnabled: !state.voiceWake.talkEnabled })}
                  >
                    ${state.voiceWake.talkEnabled ? "Disable Talk" : "Enable Talk"}
                  </button>
                </div>
              `
            : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">Logs</div>
          <div class="mono">${state.logsPath ?? "Unavailable"}</div>
          <div class="row" style="margin-top: 10px;">
            <button class="btn" @click=${props.onRevealLogs}>Reveal Logs</button>
            <button class="btn" @click=${props.onOpenNativeSettings}>Open Native Settings</button>
          </div>
        </div>
      </div>
      <div style="margin-top: 20px;">
        <div class="label">Permissions</div>
        <div style="display: grid; gap: 12px; margin-top: 12px;">
          ${(Object.keys(PERMISSION_LABELS) as NativeShellPermission[]).map(
            (permission) => html`
              <div class="list-item">
                <div class="list-title">${PERMISSION_LABELS[permission]}</div>
                <div class="list-sub">
                  ${state.permissions[permission] ? "Granted" : "Needs approval"}
                </div>
                ${state.permissions[permission]
                  ? nothing
                  : html`
                      <div class="row" style="margin-top: 8px;">
                        <button
                          class="btn btn--sm"
                          @click=${() => props.onRequestPermission(permission)}
                        >
                          Request
                        </button>
                      </div>
                    `}
              </div>
            `,
          )}
        </div>
      </div>
      <div class="row" style="margin-top: 16px;">
        <button class="btn" @click=${props.onRefreshNative}>Refresh Native State</button>
      </div>
    </div>
  `;
}

export function renderSettingsHub(props: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  sectionContent: unknown;
  nativeShellLoading: boolean;
  nativeShellError: string | null;
  nativeShellState: NativeShellState | null;
  onRefreshNative: () => void;
  onSetLaunchAtLogin: (enabled: boolean) => void;
  onRequestPermission: (permission: NativeShellPermission) => void;
  onSetVoiceWake: (params: { enabled?: boolean; talkEnabled?: boolean }) => void;
  onOpenNativeSettings: () => void;
  onRevealLogs: () => void;
}) {
  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Settings</div>
        <div class="card-sub">
          Workspace configuration, native shell controls, and diagnostics in one place.
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top: 16px;">
          ${(Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[]).map(
            (section) => html`
              <button
                class="chip ${props.section === section ? "chip-active" : ""}"
                @click=${() => props.onSectionChange(section)}
              >
                ${SETTINGS_SECTION_LABELS[section]}
              </button>
            `,
          )}
        </div>
      </div>

      ${props.section === "mac"
        ? renderMacSection({
            nativeShellLoading: props.nativeShellLoading,
            nativeShellError: props.nativeShellError,
            nativeShellState: props.nativeShellState,
            onRefreshNative: props.onRefreshNative,
            onSetLaunchAtLogin: props.onSetLaunchAtLogin,
            onRequestPermission: props.onRequestPermission,
            onSetVoiceWake: props.onSetVoiceWake,
            onOpenNativeSettings: props.onOpenNativeSettings,
            onRevealLogs: props.onRevealLogs,
          })
        : props.sectionContent}
    </section>
  `;
}

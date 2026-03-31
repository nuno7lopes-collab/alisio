import AppKit
import Observation
import SwiftUI

@MainActor
struct LumeRootView: View {
    @Environment(\.colorScheme) private var systemColorScheme

    @Bindable var state: AppState
    @Bindable private var controlChannel = ControlChannel.shared
    let updater: UpdaterProviding?
    @Bindable var shellState: LumeShellState

    private var palette: LumePalette {
        LumePalette.resolve(theme: self.shellState.preferredTheme, systemScheme: self.systemColorScheme)
    }

    private var railWidth: CGFloat {
        self.shellState.isPrimaryRailCollapsed ? 76 : 224
    }

    private var navigationSections: [[LumeShellState.Route]] {
        [
            [.assistant, .deepResearch],
            [.authentications, .organization],
            [.settings],
        ]
    }

    var body: some View {
        HStack(spacing: 0) {
            self.primaryRail
            Rectangle()
                .fill(self.palette.separator)
                .frame(width: 1)
            self.stage
        }
        .background(self.palette.canvas.ignoresSafeArea())
        .preferredColorScheme(self.shellState.preferredTheme.preferredColorScheme)
        .animation(.spring(response: 0.28, dampingFraction: 0.88), value: self.shellState.isPrimaryRailCollapsed)
    }

    private var primaryRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                LumeBrandMark(palette: self.palette)

                if !self.shellState.isPrimaryRailCollapsed {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Lume AI")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(self.palette.primaryText)
                        Text("Private AI operating layer")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                }

                Spacer(minLength: 0)

                Button {
                    self.shellState.toggleSidebar()
                } label: {
                    Image(systemName: self.shellState.isPrimaryRailCollapsed ? "sidebar.right" : "sidebar.left")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(self.palette.secondaryText)
                        .frame(width: 28, height: 28)
                        .background(
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .fill(self.palette.surfaceMuted))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 22)
            .padding(.bottom, 18)

            VStack(alignment: .leading, spacing: 18) {
                ForEach(Array(self.navigationSections.enumerated()), id: \.offset) { index, routes in
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(routes) { route in
                            self.navButton(route: route)
                        }
                    }

                    if index < self.navigationSections.count - 1 {
                        Rectangle()
                            .fill(self.palette.separator)
                            .frame(height: 1)
                            .padding(.horizontal, self.shellState.isPrimaryRailCollapsed ? 10 : 2)
                    }
                }
            }
            .padding(.horizontal, 12)

            Spacer(minLength: 0)

            self.accountSection
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
        }
        .frame(width: self.railWidth, maxHeight: .infinity, alignment: .topLeading)
        .background(self.palette.sidebar)
    }

    private func navButton(route: LumeShellState.Route) -> some View {
        let isActive = self.shellState.route == route
        return Button {
            self.shellState.show(route: route)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: route.symbolName)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 18)
                    .foregroundStyle(isActive ? self.palette.primaryText : self.palette.secondaryText)

                if !self.shellState.isPrimaryRailCollapsed {
                    Text(route.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(isActive ? self.palette.primaryText : self.palette.secondaryText)

                    Spacer(minLength: 0)

                    if route == .assistant {
                        Text("NEW")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color.black)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(self.palette.warning))
                    }
                }
            }
            .padding(.horizontal, self.shellState.isPrimaryRailCollapsed ? 12 : 14)
            .frame(height: 46)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isActive ? self.palette.surfaceMuted : .clear))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isActive ? self.palette.border : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var accountSection: some View {
        let profile = LumeMockData.currentProfile()
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                self.shellState.isAccountMenuPresented.toggle()
            } label: {
                HStack(spacing: 12) {
                    LumeInitialAvatar(title: profile.initials, palette: self.palette)

                    if !self.shellState.isPrimaryRailCollapsed {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.username)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(self.palette.primaryText)
                            Text(profile.planName)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(self.palette.secondaryText)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .padding(.horizontal, self.shellState.isPrimaryRailCollapsed ? 8 : 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: self.shellState.isPrimaryRailCollapsed ? .center : .leading)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(self.palette.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(self.palette.border, lineWidth: 1)))
            }
            .buttonStyle(.plain)
            .popover(isPresented: self.$shellState.isAccountMenuPresented, arrowEdge: .top) {
                self.accountMenu(profile: profile)
            }

            if !self.shellState.isPrimaryRailCollapsed {
                Button {
                    self.shellState.showSettings(tab: .general)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles")
                        Text("Upgrade Plan")
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
                .buttonStyle(LumePrimaryButtonStyle(palette: self.palette))
            }
        }
    }

    private func accountMenu(profile: LumeProfileSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                LumeInitialAvatar(title: profile.initials, palette: self.palette)
                VStack(alignment: .leading, spacing: 2) {
                    Text(profile.fullName)
                        .font(.system(size: 14, weight: .semibold))
                    Text(profile.planName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }
            .padding(.bottom, 4)

            self.accountMenuButton(title: "Settings", symbol: "gearshape") {
                self.shellState.route = .settings
                self.shellState.settingsSection = .general
            }
            self.accountMenuButton(title: "Support", symbol: "envelope") {
                self.shellState.route = .settings
                self.shellState.settingsSection = .support
            }
            self.accountMenuButton(title: "Upgrade Plan", symbol: "sparkles") {
                self.shellState.route = .settings
                self.shellState.settingsSection = .account
            }
            self.accountMenuButton(title: "Sign Out", symbol: "arrow.right.square", isDanger: true) {}
        }
        .padding(14)
        .frame(width: 224, alignment: .topLeading)
        .background(self.palette.sidebar)
    }

    private func accountMenuButton(
        title: String,
        symbol: String,
        isDanger: Bool = false,
        action: @escaping () -> Void) -> some View
    {
        Button {
            self.shellState.isAccountMenuPresented = false
            action()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .frame(width: 18)
                Text(title)
                Spacer(minLength: 0)
            }
            .font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .buttonStyle(LumeGhostButtonStyle(palette: self.palette, isDanger: isDanger))
    }

    private var stage: some View {
        self.stageContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(self.palette.stage)
    }

    @ViewBuilder
    private var stageContent: some View {
        switch self.shellState.route {
        case .assistant:
            LumeChatStageView(
                sessionKey: self.shellState.activeSessionKey ?? "main",
                accentHex: self.state.seamColorHex,
                palette: self.palette,
                shellState: self.shellState,
                connectionLabel: self.connectionLabel,
                onSessionKeyChanged: { sessionKey in
                    self.shellState.activeSessionKey = sessionKey
                },
                openSettings: {
                    self.shellState.route = .settings
                },
                openAuthentications: {
                    self.shellState.route = .authentications
                })
        case .deepResearch:
            LumeDeepResearchStageView(palette: self.palette)
        case .authentications:
            LumeAuthenticationsStageView(palette: self.palette, shellState: self.shellState)
        case .organization:
            LumeOrganizationStageView(palette: self.palette)
        case .settings:
            LumeSettingsStageView(
                palette: self.palette,
                shellState: self.shellState,
                profile: LumeMockData.currentProfile())
        }
    }

    private var connectionLabel: String {
        switch self.controlChannel.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .disconnected: "Disconnected"
        case let .degraded(message):
            if message.isEmpty {
                return "Degraded"
            }
            return "Degraded"
        }
    }
}

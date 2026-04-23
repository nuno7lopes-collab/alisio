import AppKit
import SwiftUI

import AlisioSupport
extension AppsSettings {
    var body: some View {
        HStack(spacing: 0) {
            self.sidebar
            self.detail
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onAppear {
            self.store.start()
            self.ensureSelection()
            if self.store.apps.isEmpty {
                Task { await self.store.refresh() }
            }
        }
        .onChange(of: self.store.apps) { _, _ in
            self.ensureSelection()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await self.store.refresh() }
        }
        .onDisappear { self.store.stop() }
    }

    private var sidebar: some View {
        SettingsSidebarScroll {
            VStack(alignment: .leading, spacing: 12) {
                if self.store.isRefreshing && self.store.apps.isEmpty {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading apps…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 6)
                } else if self.store.apps.isEmpty, let error = self.store.lastError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)

                        Button("Retry") {
                            Task { await self.store.refresh() }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 6)
                } else if self.store.apps.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No apps are available on this Mac right now.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        Button("Refresh") {
                            Task { await self.store.refresh() }
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 6)
                } else {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if !self.connectedApps.isEmpty {
                            self.sidebarSectionHeader(AppIntegrationGroup.Status.connected.sectionTitle)
                            ForEach(self.connectedApps) { app in
                                self.sidebarRow(app)
                            }
                        }

                        if !self.attentionApps.isEmpty {
                            self.sidebarSectionHeader(AppIntegrationGroup.Status.needsAttention.sectionTitle)
                            ForEach(self.attentionApps) { app in
                                self.sidebarRow(app)
                            }
                        }

                        if !self.authErrorApps.isEmpty {
                            self.sidebarSectionHeader(AppIntegrationGroup.Status.authError.sectionTitle)
                            ForEach(self.authErrorApps) { app in
                                self.sidebarRow(app)
                            }
                        }

                        if !self.disconnectedApps.isEmpty {
                            self.sidebarSectionHeader(AppIntegrationGroup.Status.disconnected.sectionTitle)
                            ForEach(self.disconnectedApps) { app in
                                self.sidebarRow(app)
                            }
                        }
                    }
                }
            }
        }
    }

    private var detail: some View {
        Group {
            if self.store.isRefreshing && self.store.apps.isEmpty {
                self.loadingDetail
            } else if self.store.apps.isEmpty, let error = self.store.lastError {
                self.errorDetail(error)
            } else if self.store.apps.isEmpty {
                self.noAppsDetail
            } else if let app = self.selectedApp {
                self.appDetail(app)
            } else {
                self.selectionPromptDetail
            }
        }
        .frame(minWidth: 500, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var loadingDetail: some View {
        VStack(alignment: .leading, spacing: 10) {
            ProgressView()
            Text("Loading apps")
                .font(.title3.weight(.semibold))
            Text("Alisio is checking which apps are available on this Mac.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private func errorDetail(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Apps")
                .font(.title3.weight(.semibold))
            Text(error)
                .font(.callout)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
            Button("Retry") {
                Task { await self.store.refresh() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private var noAppsDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Apps")
                .font(.title3.weight(.semibold))
            Text("No apps are available to connect on this Mac right now.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Refresh") {
                Task { await self.store.refresh() }
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private var selectionPromptDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Apps")
                .font(.title3.weight(.semibold))
            Text("Select an app to view its connection status and actions.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    private func appDetail(_ app: AppIntegrationGroup) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {
                self.detailHeader(for: app)
                if let statusMessage = self.store.statusMessage, !statusMessage.isEmpty {
                    self.messageBanner(text: statusMessage, tint: self.statusMessageTint(statusMessage))
                }
                if let error = self.store.lastError, !error.isEmpty {
                    self.messageBanner(text: error, tint: .red)
                }
                Divider()
                self.overviewSection(app)
                self.capabilitiesSection(app)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 18)
        }
    }

    private func sidebarRow(_ app: AppIntegrationGroup) -> some View {
        let isSelected = self.selectedAppID == app.id
        return Button {
            self.selectedAppID = app.id
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(self.appStatusTint(app.status))
                    .frame(width: 8, height: 8)

                VStack(alignment: .leading, spacing: 2) {
                    Text(app.title)
                    Text(self.appSummaryLine(app))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)
            }
            .padding(.vertical, 4)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.accentColor.opacity(0.18) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .background(Color.clear)
            .contentShape(Rectangle())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .buttonStyle(.plain)
        .contentShape(Rectangle())
    }

    private func sidebarSectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.horizontal, 4)
            .padding(.top, 2)
    }

    private func detailHeader(for app: AppIntegrationGroup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(app.title, systemImage: app.systemImage)
                    .font(.title3.weight(.semibold))
                self.statusBadge(app.status.label, color: self.appStatusTint(app.status))
                Spacer()
                self.detailHeaderActions(for: app)
            }

            HStack(spacing: 10) {
                Text(app.summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let refreshLine = self.refreshStatusLine(
                    lastUpdated: self.store.lastUpdated,
                    isRefreshing: self.store.isRefreshing)
                {
                    Text(refreshLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let detail = app.detail, !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func messageBanner(text: String, tint: Color) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    func statusBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

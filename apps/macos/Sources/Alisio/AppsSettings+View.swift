import AppKit
import SwiftUI

import AlisioSupport
extension AppsSettings {
    var body: some View {
        HStack(spacing: 16) {
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
            VStack(alignment: .leading, spacing: 6) {
                if self.store.apps.isEmpty {
                    self.sidebarPlaceholder
                } else {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(self.store.apps) { app in
                            self.sidebarRow(app)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var sidebarPlaceholder: some View {
        if self.store.isRefreshing {
            WorkspaceStateCard(
                title: "Checking apps…",
                message: "Looking for apps that are available on this Mac.",
                systemImage: "square.grid.2x2",
                showsProgress: true)
        } else if let error = self.store.lastError?.nonEmpty {
            WorkspaceStateCard(
                title: "Couldn't load apps.",
                message: error,
                systemImage: "exclamationmark.triangle.fill",
                tone: .critical,
                actionTitle: "Try again")
            {
                Task { await self.store.refresh() }
            }
        } else {
            WorkspaceStateCard(
                title: "No apps available",
                message: "When apps are ready to connect on this Mac, they appear here.",
                systemImage: "square.grid.2x2",
                actionTitle: "Refresh")
            {
                Task { await self.store.refresh() }
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
        .frame(minWidth: 520, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var loadingDetail: some View {
        self.detailState(
            title: "Checking apps",
            message: "Looking for apps that are available on this Mac.",
            systemImage: "link",
            showsProgress: true)
    }

    private func errorDetail(_ error: String) -> some View {
        self.detailState(
            title: "Couldn't load apps",
            message: error,
            systemImage: "exclamationmark.triangle.fill",
            tone: .critical,
            actionTitle: "Try again")
        {
            Task { await self.store.refresh() }
        }
    }

    private var noAppsDetail: some View {
        self.detailState(
            title: "No apps available",
            message: "Nothing can be connected on this Mac right now.",
            systemImage: "link.badge.plus",
            actionTitle: "Refresh")
        {
            Task { await self.store.refresh() }
        }
    }

    private var selectionPromptDetail: some View {
        self.detailState(
            title: "Select an app",
            message: "Its status and actions appear here.",
            systemImage: "list.bullet.rectangle")
    }

    private func appDetail(_ app: AppIntegrationGroup) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {
                self.detailHeader(for: app)

                if app.capabilities.count > 1 {
                    self.capabilitiesSection(app)
                }

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
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: app.systemImage)
                    .foregroundStyle(self.appStatusTint(app.status))
                    .frame(width: 18, height: 18, alignment: .top)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(app.title)
                            .font(.body.weight(.medium))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        self.statusBadge(app.status.label, color: self.appStatusTint(app.status))
                    }

                    Text(self.appSidebarDetailLine(app))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSelected ? Color.accentColor.opacity(0.12) : .clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                isSelected ? Color.accentColor.opacity(0.24) : .clear,
                                lineWidth: 1)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func detailHeader(for app: AppIntegrationGroup) -> some View {
        let secondaryDetail = app.detail?.nonEmpty
        return self.surfaceCard {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Label(app.title, systemImage: app.systemImage)
                        .font(.title3.weight(.semibold))

                    HStack(spacing: 8) {
                        self.statusBadge(app.status.label, color: self.appStatusTint(app.status))
                        if let refreshLine = self.refreshStatusLine(
                            lastUpdated: self.store.lastUpdated,
                            isRefreshing: self.store.isRefreshing)
                        {
                            Text(refreshLine)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Spacer(minLength: 0)

                self.detailHeaderActions(for: app)
            }

            Text(app.summary)
                .font(.callout)
                .foregroundStyle(.secondary)

            if let secondaryDetail, secondaryDetail != app.summary {
                Text(secondaryDetail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let statusMessage = self.store.statusMessage?.nonEmpty {
                WorkspaceInlineBanner(
                    text: statusMessage,
                    tone: self.statusMessageTone(self.store.statusMessageTone))
            }

            if let error = self.store.lastError?.nonEmpty {
                WorkspaceInlineBanner(text: error, tone: .critical)
            }

            self.appFactsSection(app)
        }
    }

    private func detailState(
        title: String,
        message: String,
        systemImage: String,
        tone: WorkspaceSurfaceTone = .neutral,
        showsProgress: Bool = false,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil) -> some View
    {
        VStack(alignment: .leading, spacing: 16) {
            WorkspaceStateCard(
                title: title,
                message: message,
                systemImage: systemImage,
                tone: tone,
                showsProgress: showsProgress,
                actionTitle: actionTitle,
                action: action)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }

    func statusBadge(_ text: String, color: Color) -> some View {
        StatusPill(text: text, tint: color)
    }
}

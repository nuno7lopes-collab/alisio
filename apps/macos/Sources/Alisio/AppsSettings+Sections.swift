import SwiftUI

import AlisioSupport
extension AppsSettings {
    func formSection(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        GroupBox(title) {
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    func detailHeaderActions(for app: AppIntegrationGroup) -> some View {
        HStack(spacing: 8) {
            if let primaryCapability = app.primaryCapability {
                self.capabilityActionButton(primaryCapability)
            }

            if let docsURL = app.docsURL {
                Button("Guide") {
                    self.openExternalURL(docsURL)
                }
                .buttonStyle(.bordered)
            }

            Button {
                Task { await self.store.refresh() }
            } label: {
                if self.store.isRefreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Refresh")
                }
            }
            .buttonStyle(.bordered)
            .disabled(self.store.isRefreshing)
        }
        .controlSize(.small)
    }

    func overviewSection(_ app: AppIntegrationGroup) -> some View {
        self.formSection("Overview") {
            VStack(alignment: .leading, spacing: 8) {
                Text(app.summary)
                    .font(.callout)

                if let account = self.accountText(label: app.accountLabel, email: app.accountEmail) {
                    LabeledContent("Account", value: account)
                }

                LabeledContent("Provider", value: app.providerLabel)
                LabeledContent("Status", value: app.status.label)

                if !app.chips.isEmpty {
                    self.chipRow(app.chips)
                }
            }
        }
    }

    func capabilitiesSection(_ app: AppIntegrationGroup) -> some View {
        self.formSection(app.capabilities.count > 1 ? "Access Levels" : "Access") {
            ForEach(app.capabilities) { capability in
                self.capabilityRow(capability)
                if capability.id != app.capabilities.last?.id {
                    Divider()
                }
            }
        }
    }

    func helpSection(_ app: AppIntegrationGroup, docsURL: URL) -> some View {
        self.formSection("Help") {
            Text("Need setup details for \(app.title)? Open the provider guide in your browser.")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Open setup guide") {
                self.openExternalURL(docsURL)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func capabilityRow(_ capability: AppIntegrationCapability) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(capability.title)
                        .font(.headline)
                    self.statusBadge(
                        capability.status.label,
                        color: self.capabilityTint(capability.status))
                }

                Text(capability.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(self.capabilityDetailLine(capability))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            self.capabilityActionButton(capability)
        }
    }

    @ViewBuilder
    private func capabilityActionButton(_ capability: AppIntegrationCapability) -> some View {
        if capability.status == .connected {
            Button {
                Task { await self.store.performAction(for: capability) }
            } label: {
                self.capabilityActionLabel(for: capability)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(self.store.appConnectionIsBusy(capability.id))
        } else if capability.status == .authError {
            Button {
                Task { await self.store.performAction(for: capability) }
            } label: {
                self.capabilityActionLabel(for: capability)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(self.store.appConnectionIsBusy(capability.id))
        } else {
            Button {
                Task { await self.store.performAction(for: capability) }
            } label: {
                self.capabilityActionLabel(for: capability)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(self.store.appConnectionIsBusy(capability.id))
        }
    }

    @ViewBuilder
    private func capabilityActionLabel(for capability: AppIntegrationCapability) -> some View {
        if self.store.appConnectionIsBusy(capability.id) {
            ProgressView().controlSize(.small)
        } else {
            switch capability.status {
            case .connected, .needsReconnect, .authError:
                Text(capability.status.actionTitle)
            case .disconnected:
                Text(capability.connectLabel)
            }
        }
    }

    private func chipRow(_ chips: [String]) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                ForEach(chips, id: \.self) { chip in
                    self.chip(chip)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                ForEach(chips, id: \.self) { chip in
                    self.chip(chip)
                }
            }
        }
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.secondary.opacity(0.12))
            .foregroundStyle(.secondary)
            .clipShape(Capsule())
    }
}

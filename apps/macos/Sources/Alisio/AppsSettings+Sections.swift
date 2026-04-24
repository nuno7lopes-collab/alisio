import AppKit
import SwiftUI

import AlisioSupport

private struct AppsDetailFact: Identifiable {
    let label: String
    let value: String

    var id: String {
        self.label
    }
}

extension AppsSettings {
    func surfaceCard(@ViewBuilder content: () -> some View) -> some View {
        WorkspaceSurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                content()
            }
        }
    }

    @ViewBuilder
    func detailHeaderActions(for app: AppIntegrationGroup) -> some View {
        HStack(spacing: 8) {
            if let capability = app.primaryCapability {
                self.capabilityActionButton(capability, prominent: capability.status != .connected)
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
            .controlSize(.small)
            .disabled(self.store.isRefreshing)
        }
    }

    @ViewBuilder
    func appFactsSection(_ app: AppIntegrationGroup) -> some View {
        let facts = self.appFacts(for: app)
        if !facts.isEmpty {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 140), alignment: .leading)],
                alignment: .leading,
                spacing: 12)
            {
                ForEach(facts) { fact in
                    self.factView(fact)
                }
            }
        }
    }

    func capabilitiesSection(_ app: AppIntegrationGroup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Access")
                .font(.headline)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(app.capabilities) { capability in
                    self.capabilityRow(capability)
                }
            }
        }
    }

    private func factView(_ fact: AppsDetailFact) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(fact.label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(fact.value)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func appFacts(for app: AppIntegrationGroup) -> [AppsDetailFact] {
        var facts: [AppsDetailFact] = []

        if let account = self.accountText(label: app.accountLabel, email: app.accountEmail) {
            facts.append(AppsDetailFact(label: "Account", value: account))
        }

        facts.append(AppsDetailFact(label: "Provider", value: app.providerLabel))

        if app.capabilities.count > 1 {
            let count = app.capabilities.count
            let value = count == 1 ? "1 connection" : "\(count) connections"
            facts.append(AppsDetailFact(label: "Access", value: value))
        }

        if let connectedAt = self.formatConnectedAt(app.primaryConnectedAt) {
            facts.append(AppsDetailFact(label: "Connected", value: connectedAt))
        }

        return facts
    }

    private func capabilityRow(_ capability: AppIntegrationCapability) -> some View {
        self.surfaceCard {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(capability.title)
                            .font(.headline)
                        self.statusBadge(
                            capability.status.label,
                            color: self.capabilityTint(capability.status))
                    }

                    Text(capability.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Text(self.capabilityDetailLine(capability))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                self.capabilityActionButton(capability)
            }
        }
    }

    @ViewBuilder
    private func capabilityActionButton(_ capability: AppIntegrationCapability, prominent: Bool? = nil) -> some View {
        let usesProminentStyle = prominent ?? (capability.status != .connected)
        if usesProminentStyle {
            Button {
                Task { await self.store.performAction(for: capability) }
            } label: {
                self.capabilityActionLabel(for: capability)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(self.store.appConnectionIsBusy(capability.id))
        } else {
            Button {
                Task { await self.store.performAction(for: capability) }
            } label: {
                self.capabilityActionLabel(for: capability)
            }
            .buttonStyle(.bordered)
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
            case .connected, .needsReconnect, .setupRequired:
                Text(capability.status.actionTitle)
            case .disconnected:
                Text(capability.connectLabel)
            }
        }
    }
}

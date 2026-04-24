import SwiftUI

@MainActor
struct WorkspaceSettingsLauncherView: View {
    var body: some View {
        VStack {
            Spacer(minLength: 0)

            WorkspaceSurfaceCard(padding: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Native macOS settings")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Open Settings for app setup and preferences.")
                            .font(.title3.weight(.semibold))
                        Text(
                            "Account, connection mode, permissions, Voice Wake, updates, and app preferences all live in the native Settings window.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Button {
                        SettingsWindowOpener.shared.open()
                    } label: {
                        Label("Open Settings", systemImage: "gearshape")
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
            .frame(maxWidth: 520)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}

import AppKit
import SwiftUI

import AlisioSupport

enum WorkspaceSurfaceTone {
    case neutral
    case success
    case caution
    case critical

    var tint: Color {
        switch self {
        case .neutral:
            .secondary
        case .success:
            .green
        case .caution:
            .orange
        case .critical:
            .red
        }
    }

    var foreground: Color {
        self == .neutral ? .secondary : self.tint
    }

    var background: Color {
        let base = self == .neutral ? Color.secondary : self.tint
        return base.opacity(self == .neutral ? 0.08 : 0.10)
    }
}

struct WorkspaceSurfaceCard<Content: View>: View {
    let padding: CGFloat
    @ViewBuilder let content: Content

    init(
        padding: CGFloat = 16,
        @ViewBuilder content: () -> Content)
    {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        self.content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(self.padding)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)))
    }
}

struct WorkspaceStateCard: View {
    let title: String
    let message: String
    let systemImage: String
    let tone: WorkspaceSurfaceTone
    let showsProgress: Bool
    let actionTitle: String?
    let action: (() -> Void)?

    init(
        title: String,
        message: String,
        systemImage: String,
        tone: WorkspaceSurfaceTone = .neutral,
        showsProgress: Bool = false,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil)
    {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.tone = tone
        self.showsProgress = showsProgress
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        WorkspaceSurfaceCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    if self.showsProgress {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: self.systemImage)
                            .foregroundStyle(self.tone.foreground)
                    }

                    Text(self.title)
                        .font(.headline)
                }

                Text(self.message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .buttonStyle(.bordered)
                }
            }
        }
    }
}

struct WorkspaceInlineBanner: View {
    let text: String
    let tone: WorkspaceSurfaceTone

    init(text: String, tone: WorkspaceSurfaceTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        Text(self.text)
            .font(.footnote)
            .foregroundStyle(self.tone.foreground)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(self.tone.background)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct WorkspaceRouteHeader<Trailing: View>: View {
    let title: String
    let subtitle: String
    let showsTitle: Bool
    @ViewBuilder let trailing: Trailing

    init(
        title: String,
        subtitle: String,
        showsTitle: Bool = true,
        @ViewBuilder trailing: () -> Trailing)
    {
        self.title = title
        self.subtitle = subtitle
        self.showsTitle = showsTitle
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            if self.showsTitle {
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.title)
                        .font(.headline)
                    Text(self.subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 0)
            self.trailing
        }
    }
}

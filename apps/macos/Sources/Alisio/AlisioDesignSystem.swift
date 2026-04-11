import SwiftUI

import AlisioSupport
enum AlisioThemeChoice: String, CaseIterable, Identifiable {
    case dark
    case light
    case system

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .dark: "Dark"
        case .light: "Light"
        case .system: "System"
        }
    }

    var preferredColorScheme: ColorScheme? {
        switch self {
        case .dark: .dark
        case .light: .light
        case .system: nil
        }
    }
}

enum AlisioLanguageChoice: String, CaseIterable, Identifiable {
    case english
    case portuguese
    case spanish

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .english: "English"
        case .portuguese: "Português"
        case .spanish: "Español"
        }
    }
}

struct AlisioPalette {
    let canvas: Color
    let sidebar: Color
    let stage: Color
    let surface: Color
    let surfaceMuted: Color
    let border: Color
    let separator: Color
    let primaryText: Color
    let secondaryText: Color
    let tertiaryText: Color
    let accent: Color
    let accentMuted: Color
    let success: Color
    let warning: Color
    let danger: Color
    let shadow: Color
    let userBubble: Color
    let assistantBubble: Color

    static func resolve(theme: AlisioThemeChoice, systemScheme: ColorScheme) -> AlisioPalette {
        let scheme = theme.preferredColorScheme ?? systemScheme
        if scheme == .light {
            return .init(
                canvas: Color(hex: 0xF3F4F6),
                sidebar: Color.white,
                stage: Color(hex: 0xFCFCFD),
                surface: Color.white,
                surfaceMuted: Color(hex: 0xF7F7F9),
                border: Color(hex: 0xE5E7EB),
                separator: Color(hex: 0xECEEF2),
                primaryText: Color(hex: 0x14151A),
                secondaryText: Color(hex: 0x5F6470),
                tertiaryText: Color(hex: 0x8A90A0),
                accent: Color(hex: 0x5C6CFF),
                accentMuted: Color(hex: 0xEDF0FF),
                success: Color(hex: 0x37A159),
                warning: Color(hex: 0xD98D29),
                danger: Color(hex: 0xD14B4B),
                shadow: Color.black.opacity(0.08),
                userBubble: Color(hex: 0x1D1F24),
                assistantBubble: Color.clear)
        }

        return .init(
            canvas: Color(hex: 0x101012),
            sidebar: Color(hex: 0x141416),
            stage: Color(hex: 0x101012),
            surface: Color(hex: 0x17171A),
            surfaceMuted: Color(hex: 0x1D1E22),
            border: Color.white.opacity(0.08),
            separator: Color.white.opacity(0.06),
            primaryText: Color(hex: 0xF5F5F6),
            secondaryText: Color(hex: 0xB0B2BA),
            tertiaryText: Color(hex: 0x7F838C),
            accent: Color(hex: 0x7A8CFF),
            accentMuted: Color(hex: 0x1B1E31),
            success: Color(hex: 0x4CAF61),
            warning: Color(hex: 0xF0A245),
            danger: Color(hex: 0xE05757),
            shadow: Color.black.opacity(0.28),
            userBubble: Color(hex: 0x1A1B1F),
            assistantBubble: Color.clear)
    }
}

extension Color {
    init(hex: UInt, opacity: Double = 1) {
        let red = Double((hex >> 16) & 0xFF) / 255
        let green = Double((hex >> 8) & 0xFF) / 255
        let blue = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }
}

struct AlisioPanel<Content: View>: View {
    let palette: AlisioPalette
    private let padding: CGFloat
    private let content: Content

    init(
        palette: AlisioPalette,
        padding: CGFloat = 20,
        @ViewBuilder content: () -> Content)
    {
        self.palette = palette
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        self.content
            .padding(self.padding)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(self.palette.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

struct AlisioBrandMark: View {
    let palette: AlisioPalette
    let size: CGFloat

    init(palette: AlisioPalette, size: CGFloat = 34) {
        self.palette = palette
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [self.palette.surfaceMuted, self.palette.surface],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing))
            RoundedRectangle(cornerRadius: self.size * 0.24, style: .continuous)
                .fill(self.palette.surface)
                .frame(width: self.size * 0.6, height: self.size * 0.48)
                .overlay(
                    RoundedRectangle(cornerRadius: self.size * 0.24, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1))
            Image(systemName: "terminal.fill")
                .font(.system(size: self.size * 0.3, weight: .semibold))
                .foregroundStyle(self.palette.primaryText)
        }
        .frame(width: self.size, height: self.size)
        .overlay(
            Circle()
                .strokeBorder(self.palette.border, lineWidth: 1))
    }
}

struct AlisioChip: View {
    let title: String
    let tint: Color
    let palette: AlisioPalette

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(self.tint)
                .frame(width: 8, height: 8)
            Text(self.title)
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(self.palette.primaryText)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(
            Capsule()
                .fill(self.palette.surfaceMuted)
                .overlay(Capsule().strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

struct AlisioInitialAvatar: View {
    let title: String
    let palette: AlisioPalette

    var body: some View {
        Text(String(self.title.prefix(1)).uppercased())
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [self.palette.accent, self.palette.accent.opacity(0.6)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing)))
    }
}

struct AlisioGhostButtonStyle: ButtonStyle {
    let palette: AlisioPalette
    let isDanger: Bool

    init(palette: AlisioPalette, isDanger: Bool = false) {
        self.palette = palette
        self.isDanger = isDanger
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(self.isDanger ? self.palette.danger : self.palette.primaryText)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(self.palette.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(
                                self.isDanger ? self.palette.danger.opacity(0.25) : self.palette.border,
                                lineWidth: 1)))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct AlisioPrimaryButtonStyle: ButtonStyle {
    let palette: AlisioPalette
    let tint: Color?

    init(palette: AlisioPalette, tint: Color? = nil) {
        self.palette = palette
        self.tint = tint
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(self.tint ?? self.palette.accent))
            .opacity(configuration.isPressed ? 0.86 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

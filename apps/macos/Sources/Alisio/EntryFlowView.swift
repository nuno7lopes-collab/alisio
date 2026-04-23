import SwiftUI

struct EntryFlowLegalLinks: Equatable {
    let terms: URL?
    let privacy: URL?

    init(terms: URL? = nil, privacy: URL? = nil) {
        self.terms = terms
        self.privacy = privacy
    }
}

struct EntryFlowView: View {
    @Bindable var model: EntryFlowModel

    let legalLinks: EntryFlowLegalLinks
    let onContinue: (() -> Void)?

    @Environment(\.colorScheme) private var systemScheme

    init(
        model: EntryFlowModel,
        legalLinks: EntryFlowLegalLinks = EntryFlowLegalLinks(),
        onContinue: (() -> Void)? = nil)
    {
        self.model = model
        self.legalLinks = legalLinks
        self.onContinue = onContinue
    }

    private var palette: AlisioPalette {
        AlisioPalette.resolve(theme: .system, systemScheme: self.systemScheme)
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                self.background

                self.surface
                    .frame(maxWidth: self.surfaceWidth)
                    .padding(.horizontal, proxy.size.width < 720 ? 20 : 32)
                    .padding(.vertical, 32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
        .animation(.snappy(duration: 0.24, extraBounce: 0), value: self.model.screen)
        .background(self.palette.canvas.ignoresSafeArea())
    }

    private var background: some View {
        ZStack {
            LinearGradient(
                colors: [
                    self.palette.canvas,
                    self.palette.stage.opacity(0.98),
                    self.palette.canvas,
                ],
                startPoint: .top,
                endPoint: .bottom)
                .ignoresSafeArea()

            RadialGradient(
                colors: [
                    self.palette.accent.opacity(0.28),
                    self.palette.accent.opacity(0.08),
                    .clear,
                ],
                center: .top,
                startRadius: 36,
                endRadius: 520)
                .frame(width: 820, height: 620)
                .offset(y: -260)

            Circle()
                .strokeBorder(self.palette.border.opacity(0.85), lineWidth: 1)
                .frame(width: 520, height: 520)
                .blur(radius: 0.6)
                .offset(y: -180)

            Circle()
                .strokeBorder(self.palette.accent.opacity(0.18), lineWidth: 1)
                .frame(width: 700, height: 700)
                .offset(y: -170)

            Circle()
                .fill(self.palette.accent.opacity(0.1))
                .frame(width: 340, height: 340)
                .blur(radius: 96)
                .offset(y: -230)

            Circle()
                .fill(self.palette.success.opacity(0.08))
                .frame(width: 260, height: 260)
                .blur(radius: 88)
                .offset(x: 250, y: 210)

            Circle()
                .fill(self.palette.accent.opacity(0.06))
                .frame(width: 220, height: 220)
                .blur(radius: 76)
                .offset(x: -260, y: 240)
        }
    }

    private var isLandingScreen: Bool {
        switch self.model.screen {
        case .welcome, .signIn, .createAccount:
            true
        default:
            false
        }
    }

    private var showsChromeHeader: Bool {
        !self.isLandingScreen
    }

    private var surfaceWidth: CGFloat {
        self.isLandingScreen ? 580 : 520
    }

    private var surface: some View {
        AlisioPanel(palette: self.palette, padding: 0) {
            VStack(spacing: 0) {
                if self.showsChromeHeader {
                    HStack(spacing: 12) {
                        Button {
                            self.model.goBack()
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "chevron.left")
                                Text("Back")
                            }
                            .font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                        .opacity(self.model.canGoBack ? 1 : 0)
                        .disabled(!self.model.canGoBack)

                        Spacer()

                        Text(self.screenLabel)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(self.palette.tertiaryText)
                            .textCase(.uppercase)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 20)
                    .padding(.bottom, 14)
                }

                if let errorMessage = self.model.errorMessage, !errorMessage.isEmpty {
                    EntryFlowErrorBanner(message: errorMessage, palette: self.palette)
                        .padding(.horizontal, 24)
                        .padding(.top, self.showsChromeHeader ? 0 : 24)
                        .padding(.bottom, 18)
                }

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: self.isLandingScreen ? 28 : 20) {
                        self.screenBody
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, self.showsChromeHeader || self.model.errorMessage != nil ? 0 : 28)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: self.isLandingScreen ? 0 : 560, maxHeight: self.isLandingScreen ? 760 : 620, alignment: .top)
        .shadow(color: self.palette.shadow, radius: 30, x: 0, y: 18)
    }

    @ViewBuilder
    private var screenBody: some View {
        switch self.model.screen {
        case .welcome, .signIn, .createAccount:
            EntryFlowWelcomeScreen(model: self.model, palette: self.palette)
        case .email:
            AuthFlowEmailScreen(model: self.model, palette: self.palette)
        case .emailSent:
            AuthFlowEmailWaitingScreen(model: self.model, palette: self.palette)
        case .code:
            AuthFlowCodeScreen(model: self.model, palette: self.palette)
        case .google:
            AuthFlowExternalProviderScreen(model: self.model, palette: self.palette)
        case .terms:
            AccountEntryTermsScreen(model: self.model, palette: self.palette, legalLinks: self.legalLinks)
        case .plan:
            AccountEntryPlanScreen(model: self.model, palette: self.palette)
        case .name:
            AccountEntryNameScreen(model: self.model, palette: self.palette)
        case .completed:
            EntryFlowCompletedScreen(model: self.model, palette: self.palette, onContinue: self.onContinue)
        }
    }

    private var screenLabel: String {
        switch self.model.screen {
        case .welcome:
            "Start"
        case .signIn:
            "Sign in"
        case .createAccount:
            "Create account"
        case .email:
            "Email"
        case .emailSent:
            "Check email"
        case .code:
            "Code"
        case .google:
            "Google"
        case .terms:
            "Terms"
        case .plan:
            "Plan"
        case .name:
            "Name"
        case .completed:
            "Done"
        }
    }
}

struct EntryFlowHeader: View {
    let eyebrow: String?
    let title: String
    let subtitle: String
    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(self.palette.tertiaryText)
                    .textCase(.uppercase)
            }
            Text(self.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(self.palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
            Text(self.subtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(self.palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct EntryFlowField: View {
    let title: String
    let prompt: String
    let palette: AlisioPalette
    let isMonospaced: Bool
    @Binding var text: String

    init(
        title: String,
        prompt: String,
        text: Binding<String>,
        palette: AlisioPalette,
        isMonospaced: Bool = false)
    {
        self.title = title
        self.prompt = prompt
        self._text = text
        self.palette = palette
        self.isMonospaced = isMonospaced
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(self.palette.primaryText)
            TextField(self.prompt, text: self.$text)
                .font(.system(size: 14, weight: .medium, design: self.isMonospaced ? .monospaced : .default))
                .textFieldStyle(.plain)
                .foregroundStyle(self.palette.primaryText)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(self.palette.surfaceMuted)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(self.palette.border, lineWidth: 1)))
        }
    }
}

struct EntryFlowErrorBanner: View {
    let message: String
    let palette: AlisioPalette

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(self.palette.warning)
            Text(self.message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(self.palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(self.palette.warning.opacity(0.12))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(self.palette.warning.opacity(0.25), lineWidth: 1)))
    }
}

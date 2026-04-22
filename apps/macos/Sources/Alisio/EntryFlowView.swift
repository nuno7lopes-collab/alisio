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
            let compact = proxy.size.width < 980

            ZStack {
                self.background

                Group {
                    if compact {
                        VStack(spacing: 18) {
                            self.heroColumn(compact: true)
                            self.formColumn
                        }
                    } else {
                        HStack(spacing: 22) {
                            self.heroColumn(compact: false)
                                .frame(maxWidth: 360, alignment: .topLeading)
                            self.formColumn
                                .frame(maxWidth: 460)
                        }
                    }
                }
                .padding(compact ? 20 : 32)
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
                    self.palette.stage,
                    self.palette.surfaceMuted.opacity(0.95),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing)
                .ignoresSafeArea()

            Circle()
                .fill(self.palette.accent.opacity(0.16))
                .frame(width: 320, height: 320)
                .blur(radius: 64)
                .offset(x: -180, y: -210)

            Circle()
                .fill(self.palette.success.opacity(0.11))
                .frame(width: 240, height: 240)
                .blur(radius: 56)
                .offset(x: 220, y: 180)
        }
    }

    private func heroColumn(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                AlisioBrandMark(palette: self.palette, size: compact ? 44 : 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Alisio")
                        .font(.system(size: compact ? 26 : 30, weight: .bold))
                        .foregroundStyle(self.palette.primaryText)
                    Text("Native account entry for macOS")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(self.palette.secondaryText)
                }
            }

            Text(self.heroTitle)
                .font(.system(size: compact ? 28 : 34, weight: .bold))
                .foregroundStyle(self.palette.primaryText)
                .fixedSize(horizontal: false, vertical: true)

            Text(self.heroSubtitle)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(self.palette.secondaryText)
                .fixedSize(horizontal: false, vertical: true)

            AlisioPanel(palette: self.palette, padding: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Flow")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(self.palette.tertiaryText)
                        .textCase(.uppercase)
                    ForEach(self.heroSteps) { step in
                        EntryFlowHeroStepRow(step: step, palette: self.palette)
                    }
                }
            }

            if !compact {
                Text("Phase 1 keeps account entry native and leaves gateway plumbing to the auth layer.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var formColumn: some View {
        AlisioPanel(palette: self.palette, padding: 0) {
            VStack(spacing: 0) {
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

                if let errorMessage = self.model.errorMessage, !errorMessage.isEmpty {
                    EntryFlowErrorBanner(message: errorMessage, palette: self.palette)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 18)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        self.screenBody
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 560, maxHeight: 620, alignment: .top)
        .shadow(color: self.palette.shadow, radius: 24, x: 0, y: 14)
    }

    @ViewBuilder
    private var screenBody: some View {
        switch self.model.screen {
        case .welcome:
            EntryFlowWelcomeScreen(model: self.model, palette: self.palette)
        case .signIn:
            AuthFlowChoiceScreen(model: self.model, palette: self.palette, intent: .signIn)
        case .createAccount:
            AuthFlowChoiceScreen(model: self.model, palette: self.palette, intent: .createAccount)
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

    private var heroTitle: String {
        switch self.model.screen {
        case .welcome:
            "A clean first run, built for accounts instead of setup plumbing."
        case .signIn:
            "Sign in on this Mac without dropping into the old setup wizard."
        case .createAccount:
            "Create the account surface first, then finish the rest of the product."
        case .email:
            "Use email when you want a quiet, device-native handoff."
        case .emailSent:
            "Email is in flight. The next real state is waiting or entering a code."
        case .code:
            "Backup codes keep the sign-in path native when the browser is not enough."
        case .google:
            "Google auth stays explicit so the callback contract can own completion."
        case .terms:
            "Terms are part of account completion, not an afterthought."
        case .plan:
            "Plan choice belongs in the first-run identity flow."
        case .name:
            "A single name field is enough for this phase."
        case .completed:
            "The flow is ready to hand off to the workspace layer."
        }
    }

    private var heroSubtitle: String {
        switch self.model.screen {
        case .welcome:
            "Welcome, sign in, create account, terms, plans, and identity all live in one native flow."
        case .signIn, .createAccount:
            "Email and Google are the only entry methods here. No technical runtime setup leaks into this surface."
        case .email, .emailSent, .code:
            "The email branch mirrors the real account flow: address, sent state, optional backup code."
        case .google:
            "The browser opens when needed, while this view keeps the callback state visible on the Mac."
        case .terms, .plan, .name:
            "Account completion only shows fields with a real downstream target in this phase."
        case .completed:
            "Chat A can decide where to navigate next. Chat B can wire the handlers without replacing the UI."
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

    private var heroSteps: [EntryFlowHeroStep] {
        switch self.model.screen {
        case .welcome, .signIn, .createAccount, .email:
            [
                .init(title: "Choose entry path", detail: "Welcome, sign in, or create account.", state: .current),
                .init(title: "Verify ownership", detail: "Email or Google.", state: .upcoming),
                .init(title: "Finish profile", detail: "Terms, plan, and name if needed.", state: .upcoming),
            ]
        case .emailSent, .code, .google:
            [
                .init(title: "Choose entry path", detail: "Done.", state: .done),
                .init(title: "Verify ownership", detail: "Waiting for email or Google callback.", state: .current),
                .init(title: "Finish profile", detail: "Only if the account still needs it.", state: .upcoming),
            ]
        case .terms:
            [
                .init(title: "Choose entry path", detail: "Done.", state: .done),
                .init(title: "Verify ownership", detail: "Done.", state: .done),
                .init(title: "Review terms", detail: "Required before account completion.", state: .current),
                .init(title: "Pick a plan", detail: "Free, Pro, or Max.", state: .upcoming),
                .init(title: "Add your name", detail: "How Alisio should address you.", state: .upcoming),
            ]
        case .plan:
            [
                .init(title: "Choose entry path", detail: "Done.", state: .done),
                .init(title: "Verify ownership", detail: "Done.", state: .done),
                .init(title: "Review terms", detail: "Done.", state: .done),
                .init(title: "Pick a plan", detail: "Current step.", state: .current),
                .init(title: "Add your name", detail: "Next.", state: .upcoming),
            ]
        case .name:
            [
                .init(title: "Choose entry path", detail: "Done.", state: .done),
                .init(title: "Verify ownership", detail: "Done.", state: .done),
                .init(title: "Review terms", detail: "Done.", state: .done),
                .init(title: "Pick a plan", detail: "Done.", state: .done),
                .init(title: "Add your name", detail: "Current step.", state: .current),
            ]
        case .completed:
            [
                .init(title: "Choose entry path", detail: "Done.", state: .done),
                .init(title: "Verify ownership", detail: "Done.", state: .done),
                .init(title: "Finish profile", detail: "Done.", state: .done),
            ]
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

struct EntryFlowHeroStep: Identifiable {
    enum State {
        case done
        case current
        case upcoming
    }

    let id = UUID()
    let title: String
    let detail: String
    let state: State
}

private struct EntryFlowHeroStepRow: View {
    let step: EntryFlowHeroStep
    let palette: AlisioPalette

    private var tint: Color {
        switch self.step.state {
        case .done:
            self.palette.success
        case .current:
            self.palette.accent
        case .upcoming:
            self.palette.tertiaryText.opacity(0.55)
        }
    }

    private var symbol: String {
        switch self.step.state {
        case .done:
            "checkmark.circle.fill"
        case .current:
            "circle.inset.filled"
        case .upcoming:
            "circle"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: self.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(self.tint)
                .frame(width: 16, height: 16)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(self.step.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(self.step.detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

import SwiftUI

import AlisioSupport

struct EntryFlowWelcomeScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    private var intent: EntryFlowIntent {
        self.model.selectedIntent
    }

    private var isGoogleBusy: Bool {
        self.model.activity == .google
    }

    private var isEmailBusy: Bool {
        self.model.activity == .email
    }

    private var subtitle: String {
        switch self.intent {
        case .signIn:
            "Sign in on this Mac with Google or email."
        case .createAccount:
            "Create your account on this Mac with Google or email."
        }
    }

    private var emailActionTitle: String {
        switch self.intent {
        case .signIn:
            "Sign in"
        case .createAccount:
            "Create account"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            EntryFlowBrandHero(subtitle: self.subtitle, palette: self.palette)

            VStack(spacing: 16) {
                EntryFlowIntentPicker(selectedIntent: self.intent, palette: self.palette) { intent in
                    self.model.selectIntent(intent)
                }

                Button {
                    self.model.selectIntent(self.intent)
                    Task { await self.model.beginGoogleAuth() }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "globe")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 20)
                        Text("Continue with Google")
                            .font(.system(size: 18, weight: .semibold))
                        Spacer()
                        if self.isGoogleBusy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(self.palette.accent)
                        } else {
                            Image(systemName: "arrow.right")
                                .font(.system(size: 14, weight: .bold))
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                .disabled(self.model.isBusy)

                EntryFlowDividerLabel(label: "or", palette: self.palette)

                EntryFlowInlineField(
                    systemImage: "envelope",
                    prompt: "name@example.com",
                    text: self.$model.draft.email,
                    palette: self.palette)
                {
                    self.sendEmail()
                }

                Button {
                    self.sendEmail()
                } label: {
                    HStack(spacing: 10) {
                        if self.isEmailBusy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        }
                        Text(self.emailActionTitle)
                            .font(.system(size: 18, weight: .semibold))
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                .disabled(self.model.isBusy)
            }

            Text("Google opens in the browser. Email sends a link and a backup code.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(self.palette.tertiaryText)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .frame(maxWidth: .infinity)
    }

    private func sendEmail() {
        guard !self.model.isBusy else { return }
        self.model.selectIntent(self.intent)
        Task { await self.model.beginEmailAuth() }
    }
}

struct AuthFlowEmailScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    private var title: String {
        self.model.intent == .createAccount ? "Create with email" : "Continue with email"
    }

    private var subtitle: String {
        "We will send a sign-in link and a 6-digit backup code."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(eyebrow: "Email", title: self.title, subtitle: self.subtitle, palette: self.palette)

            EntryFlowField(
                title: "Email address",
                prompt: "name@example.com",
                text: self.$model.draft.email,
                palette: self.palette)

            Button {
                Task { await self.model.beginEmailAuth() }
            } label: {
                HStack {
                    if self.model.activity == .email {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    }
                    Text("Send email")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            .disabled(self.model.isBusy)

            EntryFlowFeatureRow(
                title: "Stay in the app",
                detail: "The same email can include a backup code you can enter here.",
                icon: "numbers.rectangle",
                palette: self.palette)
        }
    }
}

struct AuthFlowEmailWaitingScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    private var emailLabel: String {
        let fallback = self.model.draft.email.trimmingCharacters(in: .whitespacesAndNewlines)
        return self.model.emailDelivery?.email ?? fallback
    }

    private var message: String {
        self.model.emailDelivery?.message ??
            "Check your inbox for the sign-in link. If the email includes a backup code, you can enter it here."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Check email",
                title: "Check your email",
                subtitle: "Sent to \(self.emailLabel).",
                palette: self.palette)

            VStack(alignment: .leading, spacing: 10) {
                EntryFlowFeatureRow(
                    title: "Open the link",
                    detail: self.message,
                    icon: "envelope.open",
                    palette: self.palette)
                EntryFlowFeatureRow(
                    title: "Or enter the code here",
                    detail: "Use the backup code from the same email if you want to stay in the app.",
                    icon: "key.viewfinder",
                    palette: self.palette)
            }

            VStack(spacing: 12) {
                Button {
                    self.model.showCodeEntry()
                } label: {
                    Text("Enter code")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))

                Button {
                    Task { await self.model.resendEmail() }
                } label: {
                    HStack(spacing: 8) {
                        if self.model.activity == .email {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text("Send again")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
                .disabled(self.model.isBusy)
            }
        }
    }
}

struct AuthFlowCodeScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Code",
                title: "Enter your 6-digit code",
                subtitle: "Sent to \(self.model.draft.email).",
                palette: self.palette)

            EntryFlowField(
                title: "Verification code",
                prompt: "123456",
                text: self.$model.draft.code,
                palette: self.palette,
                isMonospaced: true)

            Button {
                Task { await self.model.verifyEmailCode() }
            } label: {
                HStack(spacing: 8) {
                    if self.model.activity == .code {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    }
                    Text("Continue")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            .disabled(self.model.isBusy)

            EntryFlowFeatureRow(
                title: "Still waiting on the link?",
                detail: "The email link can still finish sign-in in the browser if you prefer.",
                icon: "sparkle.magnifyingglass",
                palette: self.palette)
        }
    }
}

struct AuthFlowExternalProviderScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    private var session: EntryFlowExternalAuthSession? {
        self.model.externalAuthSession
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: self.session?.provider.title ?? "Google",
                title: self.session?.title ?? "Finish in your browser",
                subtitle: self.session?.message ?? "Complete Google sign-in in the browser, then return here.",
                palette: self.palette)

            EntryFlowFeatureRow(
                title: "Browser step",
                detail: "This view stays open while the callback completes the handoff.",
                icon: "arrow.up.forward.app",
                palette: self.palette)

            EntryFlowFeatureRow(
                title: "Need a native path?",
                detail: "Go back and choose email instead.",
                icon: "rectangle.stack.badge.person.crop",
                palette: self.palette)

            if let url = self.session?.setupURL {
                Link(destination: url) {
                    HStack {
                        Text("Open Google again")
                            .font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Image(systemName: "arrow.up.right")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(self.palette.accent))
            }
        }
    }
}

struct EntryFlowFeatureRow: View {
    let title: String
    let detail: String
    let icon: String
    let palette: AlisioPalette

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: self.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(self.palette.accent)
                .frame(width: 18, height: 18)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(self.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(self.palette.primaryText)
                Text(self.detail)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct EntryFlowBrandHero: View {
    let subtitle: String
    let palette: AlisioPalette

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                self.palette.accent.opacity(0.22),
                                self.palette.accent.opacity(0.06),
                                .clear,
                            ],
                            center: .center,
                            startRadius: 18,
                            endRadius: 110))
                    .frame(width: 230, height: 230)

                Circle()
                    .strokeBorder(self.palette.border.opacity(0.95), lineWidth: 1)
                    .frame(width: 178, height: 178)

                Circle()
                    .strokeBorder(self.palette.accent.opacity(0.22), lineWidth: 1)
                    .frame(width: 220, height: 220)

                AlisioBrandMark(palette: self.palette, size: 72)
            }
            .frame(height: 220)

            VStack(spacing: 8) {
                Text(AlisioBrand.displayName)
                    .font(.system(size: 52, weight: .light, design: .rounded))
                    .tracking(1.2)
                    .foregroundStyle(self.palette.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(self.subtitle)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct EntryFlowIntentPicker: View {
    let selectedIntent: EntryFlowIntent
    let palette: AlisioPalette
    let onSelect: (EntryFlowIntent) -> Void

    private let intents: [EntryFlowIntent] = [.signIn, .createAccount]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(self.intents, id: \.rawValue) { intent in
                Button {
                    self.onSelect(intent)
                } label: {
                    Text(intent.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(intent == self.selectedIntent ? self.palette.primaryText : self.palette.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.plain)
                .background(
                    Capsule()
                        .fill(intent == self.selectedIntent ? self.palette.surface : .clear)
                        .overlay(
                            Capsule()
                                .strokeBorder(
                                    intent == self.selectedIntent
                                        ? self.palette.border
                                        : Color.clear,
                                    lineWidth: 1)))
            }
        }
        .padding(6)
        .background(
            Capsule()
                .fill(self.palette.surfaceMuted)
                .overlay(Capsule().strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

private struct EntryFlowDividerLabel: View {
    let label: String
    let palette: AlisioPalette

    var body: some View {
        HStack(spacing: 14) {
            Rectangle()
                .fill(self.palette.separator)
                .frame(height: 1)
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(self.palette.tertiaryText)
                .textCase(.uppercase)
            Rectangle()
                .fill(self.palette.separator)
                .frame(height: 1)
        }
    }
}

private struct EntryFlowInlineField: View {
    let systemImage: String
    let prompt: String
    let palette: AlisioPalette
    let onSubmit: () -> Void

    @Binding var text: String

    init(
        systemImage: String,
        prompt: String,
        text: Binding<String>,
        palette: AlisioPalette,
        onSubmit: @escaping () -> Void)
    {
        self.systemImage = systemImage
        self.prompt = prompt
        self._text = text
        self.palette = palette
        self.onSubmit = onSubmit
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: self.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(self.palette.secondaryText)
                .frame(width: 20)

            TextField(self.prompt, text: self.$text)
                .font(.system(size: 18, weight: .medium))
                .textFieldStyle(.plain)
                .foregroundStyle(self.palette.primaryText)
                .onSubmit {
                    self.onSubmit()
                }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 18)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(self.palette.surfaceMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(self.palette.border, lineWidth: 1)))
    }
}

import SwiftUI

struct EntryFlowWelcomeScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Welcome",
                title: "Start with the account, not the machine.",
                subtitle: "The first-run flow now begins with identity: sign in or create an account before the rest of the workspace appears.",
                palette: self.palette)

            VStack(spacing: 12) {
                Button {
                    self.model.showSignIn()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.badge.checkmark")
                            .font(.system(size: 16, weight: .semibold))
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Sign in")
                                .font(.system(size: 15, weight: .semibold))
                            Text("For an existing Alisio account.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(self.palette.secondaryText)
                        }
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .bold))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))

                Button {
                    self.model.showCreateAccount()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 16, weight: .semibold))
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Create account")
                                .font(.system(size: 15, weight: .semibold))
                            Text("For a new Alisio identity on this Mac.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(self.palette.secondaryText)
                        }
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .bold))
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            }

            VStack(alignment: .leading, spacing: 12) {
                EntryFlowFeatureRow(
                    title: "Native first-run surface",
                    detail: "No gateway runtime choices, permissions, or deep technical setup on this first screen.",
                    icon: "macwindow",
                    palette: self.palette)
                EntryFlowFeatureRow(
                    title: "One auth surface",
                    detail: "Google and email live inside the same flow instead of scattered setup affordances.",
                    icon: "person.badge.key",
                    palette: self.palette)
                EntryFlowFeatureRow(
                    title: "Profile completion when needed",
                    detail: "Terms, plan, and name only appear after auth requires them.",
                    icon: "checklist",
                    palette: self.palette)
            }
        }
    }
}

struct AuthFlowChoiceScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette
    let intent: EntryFlowIntent

    private var isGoogleBusy: Bool {
        self.model.activity == .google
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: self.intent.title,
                title: self.intent == .signIn ? "Sign in to Alisio" : "Create your Alisio account",
                subtitle: self.intent == .signIn
                    ? "Choose the sign-in method you already trust on this device."
                    : "Choose how this Mac should start your new Alisio account.",
                palette: self.palette)

            VStack(spacing: 12) {
                EntryFlowProviderButton(
                    title: "Continue with Google",
                    subtitle: "Open the browser and return through the callback contract.",
                    icon: "globe",
                    palette: self.palette,
                    prominent: true,
                    trailing: self.isGoogleBusy ? .progress : .arrow)
                {
                    Task { await self.model.beginGoogleAuth() }
                }
                .disabled(self.model.isBusy)

                EntryFlowProviderButton(
                    title: "Continue with email",
                    subtitle: "Receive a sign-in link and a backup code in your inbox.",
                    icon: "envelope.badge",
                    palette: self.palette,
                    prominent: false,
                    trailing: .arrow)
                {
                    self.model.continueWithEmail()
                }
                .disabled(self.model.isBusy)
            }

            HStack(spacing: 6) {
                Text(self.intent.alternatePrompt)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.palette.secondaryText)
                Button(self.intent.alternateActionTitle) {
                    self.model.showAlternateIntent()
                }
                .buttonStyle(.plain)
                .foregroundStyle(self.palette.accent)
                .font(.system(size: 13, weight: .semibold))
            }
        }
    }
}

struct AuthFlowEmailScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    private var title: String {
        self.model.intent == .createAccount ? "Use email to continue" : "Continue with email"
    }

    private var subtitle: String {
        self.model.intent == .createAccount
            ? "We will send a sign-in link and a 6-digit backup code to finish creating the account."
            : "We will send a sign-in link and a 6-digit backup code for this Mac."
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
                title: "Native fallback",
                detail: "If the browser flow is not convenient, the same email may include a 6-digit code you can enter here.",
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
            "Check your inbox for the Alisio sign-in link. If the email also includes a 6-digit backup code, you can enter it here."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Check email",
                title: "Watch for the email",
                subtitle: "Sent to \(self.emailLabel).",
                palette: self.palette)

            VStack(alignment: .leading, spacing: 10) {
                EntryFlowFeatureRow(
                    title: "Open the sign-in link",
                    detail: self.message,
                    icon: "envelope.open",
                    palette: self.palette)
                EntryFlowFeatureRow(
                    title: "Or stay in the app",
                    detail: "Use the backup code from the same email if you want to finish natively.",
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
                subtitle: "Use the backup code from the email sent to \(self.model.draft.email).",
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
                title: "Still waiting on the browser?",
                detail: "The email link can still finish sign-in there. This code path exists so the Mac app can stay native.",
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
                title: self.session?.title ?? "Continue in your browser",
                subtitle: self.session?.message ?? "Finish Google sign-in in the browser, then let the callback return here.",
                palette: self.palette)

            EntryFlowFeatureRow(
                title: "Browser-owned step",
                detail: "This state stays visible while the callback contract completes the OAuth handoff.",
                icon: "arrow.up.forward.app",
                palette: self.palette)

            EntryFlowFeatureRow(
                title: "No hidden fallback",
                detail: "If you want a native path instead, go back and choose email.",
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

private struct EntryFlowProviderButton: View {
    enum Trailing {
        case arrow
        case progress
    }

    let title: String
    let subtitle: String
    let icon: String
    let palette: AlisioPalette
    let prominent: Bool
    let trailing: Trailing
    let action: () -> Void

    var body: some View {
        Group {
            if self.prominent {
                Button(action: self.action) {
                    self.content
                        .foregroundStyle(Color.white)
                }
                .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            } else {
                Button(action: self.action) {
                    self.content
                        .foregroundStyle(self.palette.primaryText)
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
            }
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            Image(systemName: self.icon)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(self.title)
                    .font(.system(size: 15, weight: .semibold))
                Text(self.subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(self.prominent ? Color.white.opacity(0.82) : self.palette.secondaryText)
            }
            Spacer(minLength: 0)
            switch self.trailing {
            case .arrow:
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .bold))
            case .progress:
                ProgressView()
                    .controlSize(.small)
                    .tint(self.prominent ? .white : self.palette.accent)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
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

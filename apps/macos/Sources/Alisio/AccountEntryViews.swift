import SwiftUI

struct AccountEntryTermsScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette
    let legalLinks: EntryFlowLegalLinks

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Terms",
                title: "Review the terms before finishing this account",
                subtitle: "Terms acceptance is part of account completion, so it stays inside the flow instead of hiding in settings later.",
                palette: self.palette)

            VStack(alignment: .leading, spacing: 14) {
                Toggle(isOn: self.$model.draft.acceptedTerms) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("I agree to the Terms of Service and Privacy Policy.")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(self.palette.primaryText)
                        Text("This acceptance is recorded when the account profile is completed.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                }
                .toggleStyle(.checkbox)

                if self.legalLinks.terms != nil || self.legalLinks.privacy != nil {
                    HStack(spacing: 14) {
                        if let terms = self.legalLinks.terms {
                            Link("Terms of Service", destination: terms)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(self.palette.accent)
                        }
                        if let privacy = self.legalLinks.privacy {
                            Link("Privacy Policy", destination: privacy)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(self.palette.accent)
                        }
                    }
                }
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(self.palette.surfaceMuted)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(self.palette.border, lineWidth: 1)))

            Button {
                self.model.continueFromTerms()
            } label: {
                Text("Continue")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
        }
    }
}

struct AccountEntryPlanScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Plan",
                title: "Choose your plan",
                subtitle: "Plans belong to first-run identity because the product should know what kind of workspace to shape around you.",
                palette: self.palette)

            VStack(spacing: 12) {
                ForEach(EntryFlowPlan.allCases) { plan in
                    AccountEntryPlanCard(
                        plan: plan,
                        isSelected: self.model.draft.selectedPlan == plan,
                        palette: self.palette)
                    {
                        self.model.draft.selectedPlan = plan
                    }
                }
            }

            Button {
                self.model.continueFromPlan()
            } label: {
                Text("Continue")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
        }
    }
}

struct AccountEntryNameScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Name",
                title: "What should Alisio call you?",
                subtitle: "Only ask for the name we actually need in this phase. No fake birthday persistence.",
                palette: self.palette)

            if !self.model.draft.email.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "envelope")
                    Text(self.model.draft.email)
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundStyle(self.palette.secondaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(self.palette.surfaceMuted)
                        .overlay(Capsule().strokeBorder(self.palette.border, lineWidth: 1)))
            }

            EntryFlowField(
                title: "Name",
                prompt: "Taylor",
                text: self.$model.draft.displayName,
                palette: self.palette)

            Button {
                Task { await self.model.submitProfile() }
            } label: {
                HStack(spacing: 8) {
                    if self.model.activity == .profile {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                    }
                    Text("Finish account")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
            .disabled(self.model.isBusy)
        }
    }
}

struct EntryFlowCompletedScreen: View {
    @Bindable var model: EntryFlowModel
    let palette: AlisioPalette
    let onContinue: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EntryFlowHeader(
                eyebrow: "Done",
                title: self.model.completion?.title ?? "Finished",
                subtitle: self.model.completion?.message ??
                    "The Phase 1 entry flow is complete and ready for workspace handoff.",
                palette: self.palette)

            VStack(alignment: .leading, spacing: 12) {
                EntryFlowFeatureRow(
                    title: "Single path",
                    detail: "The native Mac flow now owns welcome, auth, terms, plan selection, and identity.",
                    icon: "point.topleft.down.curvedto.point.bottomright.up",
                    palette: self.palette)
                EntryFlowFeatureRow(
                    title: "Integration-ready",
                    detail: "Handlers can be wired to the gateway/auth layer without replacing these screens.",
                    icon: "link.badge.plus",
                    palette: self.palette)
            }

            VStack(spacing: 12) {
                if let onContinue {
                    Button(action: onContinue) {
                        Text("Continue")
                            .font(.system(size: 14, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(AlisioPrimaryButtonStyle(palette: self.palette))
                }

                Button {
                    self.model.restart()
                } label: {
                    Text("Start over")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
                .buttonStyle(AlisioGhostButtonStyle(palette: self.palette))
            }
        }
    }
}

private struct AccountEntryPlanCard: View {
    let plan: EntryFlowPlan
    let isSelected: Bool
    let palette: AlisioPalette
    let action: () -> Void

    private var accent: Color {
        switch self.plan {
        case .free:
            self.palette.secondaryText
        case .pro:
            self.palette.accent
        case .max:
            self.palette.success
        }
    }

    var body: some View {
        Button(action: self.action) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(self.plan.eyebrow)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(self.accent)
                            .textCase(.uppercase)
                        Text(self.plan.title)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(self.palette.primaryText)
                        Text(self.plan.summary)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(self.palette.secondaryText)
                    }
                    Spacer()
                    Image(systemName: self.isSelected ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(self.isSelected ? self.accent : self.palette.tertiaryText)
                }

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(self.plan.highlights, id: \.self) { item in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(self.accent)
                                .padding(.top, 2)
                            Text(item)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(self.palette.primaryText)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(self.isSelected ? self.accent.opacity(0.11) : self.palette.surfaceMuted)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(self.isSelected ? self.accent.opacity(0.45) : self.palette.border, lineWidth: 1)))
        }
        .buttonStyle(.plain)
    }
}

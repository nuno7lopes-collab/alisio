import Foundation
import Observation

@MainActor
@Observable
final class EntryFlowModel {
    private let handlers: EntryFlowHandlers
    private var history: [EntryFlowScreen] = []

    var screen: EntryFlowScreen = .welcome
    var draft = EntryFlowDraft()
    var intent: EntryFlowIntent?
    var activeProvider: EntryFlowProvider?
    var emailDelivery: EntryFlowEmailDelivery?
    var externalAuthSession: EntryFlowExternalAuthSession?
    var completion: EntryFlowCompletion?
    var activity: EntryFlowActivity?
    var errorMessage: String?

    init(handlers: EntryFlowHandlers) {
        self.handlers = handlers
        self.intent = .signIn
    }

    var isBusy: Bool {
        self.activity != nil
    }

    var canGoBack: Bool {
        !self.history.isEmpty && !self.isBusy
    }

    var selectedIntent: EntryFlowIntent {
        self.intent ?? .signIn
    }

    func restart() {
        self.history.removeAll()
        self.screen = .welcome
        self.intent = .signIn
        self.activeProvider = nil
        self.emailDelivery = nil
        self.externalAuthSession = nil
        self.completion = nil
        self.activity = nil
        self.errorMessage = nil
        self.draft = EntryFlowDraft()
    }

    func selectIntent(_ intent: EntryFlowIntent) {
        self.intent = intent
        self.errorMessage = nil
    }

    func goBack() {
        guard self.canGoBack, let previous = self.history.popLast() else { return }
        self.errorMessage = nil
        self.screen = previous
    }

    func showSignIn() {
        self.selectIntent(.signIn)
        self.show(.signIn)
    }

    func showCreateAccount() {
        self.selectIntent(.createAccount)
        self.show(.createAccount)
    }

    func showAlternateIntent() {
        switch self.intent {
        case .signIn:
            self.showCreateAccount()
        case .createAccount:
            self.showSignIn()
        case nil:
            self.showSignIn()
        }
    }

    func continueWithEmail() {
        guard self.intent != nil else { return }
        self.activeProvider = .email
        self.show(.email)
    }

    func showCodeEntry() {
        guard self.intent != nil else { return }
        self.errorMessage = nil
        self.show(.code)
    }

    func continueFromTerms() {
        self.errorMessage = nil
        guard self.draft.acceptedTerms else {
            self.errorMessage = "Accept the Terms of Service and Privacy Policy to continue."
            return
        }
        self.show(.plan)
    }

    func continueFromPlan() {
        self.errorMessage = nil
        guard self.draft.selectedPlan != nil else {
            self.errorMessage = "Choose a plan to continue."
            return
        }
        self.show(.name)
    }

    func applyAuthenticationResolution(_ resolution: EntryFlowAuthResolution) {
        self.errorMessage = nil
        self.history.removeAll()
        self.emailDelivery = nil
        self.externalAuthSession = nil

        switch resolution {
        case let .signedIn(email):
            let normalizedEmail = Self.normalizeEmail(email)
            if !normalizedEmail.isEmpty {
                self.draft.email = normalizedEmail
            }
            self.completion = .signedIn(email: self.draft.email)
            self.screen = .completed
        case let .needsProfile(seed):
            self.intent = .createAccount
            self.draft.email = Self.normalizeEmail(seed.email)
            if let displayName = seed.displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !displayName.isEmpty
            {
                self.draft.displayName = displayName
            }
            if let selectedPlan = seed.selectedPlan {
                self.draft.selectedPlan = selectedPlan
            }
            self.completion = nil
            self.screen = .terms
        }
    }

    func beginGoogleAuth() async {
        guard let intent else { return }
        self.errorMessage = nil
        self.activity = .google
        defer { self.activity = nil }
        do {
            self.activeProvider = .google
            self.externalAuthSession = try await self.handlers.beginGoogleAuth(intent)
            self.show(.google)
        } catch {
            self.errorMessage = Self.message(for: error)
        }
    }

    func beginEmailAuth() async {
        guard let intent else { return }
        self.errorMessage = nil

        let normalizedEmail = Self.normalizeEmail(self.draft.email)
        guard let emailValidation = Self.validateEmail(normalizedEmail) else {
            self.draft.email = normalizedEmail
            self.activity = .email
            defer { self.activity = nil }
            do {
                self.activeProvider = .email
                let delivery = try await self.handlers.beginEmailAuth(normalizedEmail, intent)
                self.draft.email = Self.normalizeEmail(delivery.email)
                self.emailDelivery = delivery
                self.show(.emailSent)
            } catch {
                self.errorMessage = Self.message(for: error)
            }
            return
        }

        self.errorMessage = emailValidation
    }

    func resendEmail() async {
        await self.beginEmailAuth()
    }

    func verifyEmailCode() async {
        guard let intent else { return }
        self.errorMessage = nil

        let normalizedEmail = Self.normalizeEmail(self.draft.email)
        let normalizedCode = Self.normalizeCode(self.draft.code)

        if let emailError = Self.validateEmail(normalizedEmail) {
            self.errorMessage = emailError
            return
        }
        if let codeError = Self.validateCode(normalizedCode) {
            self.errorMessage = codeError
            return
        }

        self.draft.email = normalizedEmail
        self.draft.code = normalizedCode
        self.activity = .code
        defer { self.activity = nil }
        do {
            let resolution = try await self.handlers.verifyEmailCode(normalizedEmail, normalizedCode, intent)
            self.applyAuthenticationResolution(resolution)
        } catch {
            self.errorMessage = Self.message(for: error)
        }
    }

    func submitProfile() async {
        guard let intent, let provider = self.activeProvider else { return }
        self.errorMessage = nil

        let normalizedName = self.draft.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard self.draft.acceptedTerms else {
            self.errorMessage = "Accept the Terms of Service and Privacy Policy to continue."
            return
        }
        guard let plan = self.draft.selectedPlan else {
            self.errorMessage = "Choose a plan to continue."
            return
        }
        guard !normalizedName.isEmpty else {
            self.errorMessage = "Add the name Alisio should use for you."
            return
        }
        guard Self.validateEmail(self.draft.email) == nil else {
            self.errorMessage = "Start from email or Google before finishing the account."
            return
        }

        self.activity = .profile
        defer { self.activity = nil }
        do {
            let submission = EntryFlowProfileSubmission(
                email: self.draft.email,
                displayName: normalizedName,
                plan: plan,
                termsAcceptedAt: Date(),
                provider: provider,
                origin: intent)
            try await self.handlers.completeProfile(submission)
            self.draft.displayName = normalizedName
            self.completion = .accountCreated(displayName: normalizedName, plan: plan)
            self.history.removeAll()
            self.screen = .completed
        } catch {
            self.errorMessage = Self.message(for: error)
        }
    }

    private func show(_ screen: EntryFlowScreen) {
        if self.screen != screen {
            self.history.append(self.screen)
        }
        self.errorMessage = nil
        self.screen = screen
    }

    private static func normalizeEmail(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func normalizeCode(_ value: String) -> String {
        value.unicodeScalars
            .filter(CharacterSet.decimalDigits.contains)
            .map(String.init)
            .joined()
    }

    private static func validateEmail(_ value: String) -> String? {
        guard !value.isEmpty else {
            return "Add an email address."
        }
        let pattern = #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#
        let predicate = NSPredicate(format: "SELF MATCHES %@", pattern)
        guard predicate.evaluate(with: value) else {
            return "Use a valid email address."
        }
        return nil
    }

    private static func validateCode(_ value: String) -> String? {
        guard !value.isEmpty else {
            return "Enter the 6-digit code from your email."
        }
        guard value.count == 6 else {
            return "Enter the 6-digit code from your email."
        }
        return nil
    }

    private static func message(for error: Error) -> String {
        let description = (error as NSError).localizedDescription.trimmingCharacters(
            in: .whitespacesAndNewlines)
        return description.isEmpty ? "Something went wrong. Try again." : description
    }
}

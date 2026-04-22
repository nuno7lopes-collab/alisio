import Foundation
import Testing
@testable import Alisio

@Suite(.serialized)
@MainActor
struct EntryFlowModelTests {
    @Test func `email sign in flow completes without profile setup`() async {
        let model = EntryFlowModel(
            handlers: EntryFlowHandlers(
                beginGoogleAuth: { _ in
                    EntryFlowExternalAuthSession(
                        provider: .google,
                        setupURL: URL(string: "https://example.com/google"),
                        title: "Continue in browser",
                        message: "Finish Google sign-in.")
                },
                beginEmailAuth: { email, _ in
                    EntryFlowEmailDelivery(
                        email: email,
                        message: "Check your email for the sign-in link and backup code.")
                },
                verifyEmailCode: { email, code, intent in
                    #expect(email == "person@example.com")
                    #expect(code == "123456")
                    #expect(intent == .signIn)
                    return .signedIn(email: email)
                },
                completeProfile: { _ in }),
        )

        model.showSignIn()
        model.continueWithEmail()
        model.draft.email = " Person@Example.com "
        await model.beginEmailAuth()
        #expect(model.screen == .emailSent)
        #expect(model.emailDelivery?.email == "person@example.com")

        model.showCodeEntry()
        model.draft.code = "123 456"
        await model.verifyEmailCode()

        #expect(model.screen == .completed)
        #expect(model.completion == .signedIn(email: "person@example.com"))
        #expect(model.errorMessage == nil)
    }

    @Test func `account creation flow requires terms plan and name`() async {
        var capturedSubmission: EntryFlowProfileSubmission?
        let model = EntryFlowModel(
            handlers: EntryFlowHandlers(
                beginGoogleAuth: { _ in
                    EntryFlowExternalAuthSession(
                        provider: .google,
                        setupURL: URL(string: "https://example.com/google"),
                        title: "Continue in browser",
                        message: "Finish Google sign-in.")
                },
                beginEmailAuth: { email, _ in
                    EntryFlowEmailDelivery(
                        email: email,
                        message: "Check your email for the sign-in link and backup code.")
                },
                verifyEmailCode: { email, code, intent in
                    #expect(email == "new@example.com")
                    #expect(code == "654321")
                    #expect(intent == .createAccount)
                    return .needsProfile(
                        EntryFlowProfileSeed(
                            email: email,
                            displayName: "Taylor",
                            selectedPlan: .max))
                },
                completeProfile: { submission in
                    capturedSubmission = submission
                }),
        )

        model.showCreateAccount()
        model.continueWithEmail()
        model.draft.email = "new@example.com"
        await model.beginEmailAuth()
        model.showCodeEntry()
        model.draft.code = "654321"
        await model.verifyEmailCode()

        #expect(model.screen == .terms)
        #expect(model.draft.displayName == "Taylor")
        #expect(model.draft.selectedPlan == .max)
        #expect(model.canGoBack == false)

        model.continueFromTerms()
        #expect(
            model.errorMessage ==
                "Accept the Terms of Service and Privacy Policy to continue.")

        model.draft.acceptedTerms = true
        model.continueFromTerms()
        #expect(model.screen == .plan)

        model.draft.selectedPlan = nil
        model.continueFromPlan()
        #expect(model.errorMessage == "Choose a plan to continue.")

        model.draft.selectedPlan = .pro
        model.continueFromPlan()
        #expect(model.screen == .name)

        model.draft.displayName = "   "
        await model.submitProfile()
        #expect(model.errorMessage == "Add the name Alisio should use for you.")

        model.draft.displayName = "Taylor"
        await model.submitProfile()

        #expect(model.screen == .completed)
        #expect(model.completion == .accountCreated(displayName: "Taylor", plan: .pro))
        #expect(capturedSubmission?.email == "new@example.com")
        #expect(capturedSubmission?.displayName == "Taylor")
        #expect(capturedSubmission?.plan == .pro)
        #expect(capturedSubmission?.provider == .email)
        #expect(capturedSubmission?.origin == .createAccount)
    }

    @Test func `google auth waits for external resolution and seeds profile`() async {
        let session = EntryFlowExternalAuthSession(
            provider: .google,
            setupURL: URL(string: "https://example.com/google"),
            title: "Continue in browser",
            message: "Finish Google sign-in.")
        let model = EntryFlowModel(
            handlers: EntryFlowHandlers(
                beginGoogleAuth: { intent in
                    #expect(intent == .createAccount)
                    return session
                },
                beginEmailAuth: { email, _ in
                    EntryFlowEmailDelivery(
                        email: email,
                        message: "Check your email.")
                },
                verifyEmailCode: { email, _, _ in
                    .signedIn(email: email)
                },
                completeProfile: { _ in }),
        )

        model.showCreateAccount()
        await model.beginGoogleAuth()

        #expect(model.screen == .google)
        #expect(model.externalAuthSession == session)
        #expect(model.activeProvider == .google)

        model.applyAuthenticationResolution(
            .needsProfile(
                EntryFlowProfileSeed(
                    email: "quinn@example.com",
                    displayName: "Quinn",
                    selectedPlan: .max)))

        #expect(model.screen == .terms)
        #expect(model.draft.email == "quinn@example.com")
        #expect(model.draft.displayName == "Quinn")
        #expect(model.draft.selectedPlan == .max)
        #expect(model.canGoBack == false)
    }

    @Test func `back returns to previous auth screen`() {
        let model = EntryFlowModel(
            handlers: EntryFlowHandlers(
                beginGoogleAuth: { _ in
                    EntryFlowExternalAuthSession(
                        provider: .google,
                        setupURL: URL(string: "https://example.com/google"),
                        title: "Continue in browser",
                        message: "Finish Google sign-in.")
                },
                beginEmailAuth: { email, _ in
                    EntryFlowEmailDelivery(email: email, message: "Check your email.")
                },
                verifyEmailCode: { email, _, _ in
                    .signedIn(email: email)
                },
                completeProfile: { _ in }),
        )

        model.showSignIn()
        model.continueWithEmail()
        #expect(model.screen == .email)
        #expect(model.canGoBack)

        model.goBack()

        #expect(model.screen == .signIn)
        #expect(model.errorMessage == nil)
    }
}

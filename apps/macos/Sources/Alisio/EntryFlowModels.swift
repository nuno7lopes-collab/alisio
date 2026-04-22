import Foundation

enum EntryFlowIntent: String, Equatable {
    case signIn = "sign_in"
    case createAccount = "create_account"

    var title: String {
        switch self {
        case .signIn:
            "Sign in"
        case .createAccount:
            "Create account"
        }
    }

    var alternateActionTitle: String {
        switch self {
        case .signIn:
            "Create account"
        case .createAccount:
            "Sign in"
        }
    }

    var alternatePrompt: String {
        switch self {
        case .signIn:
            "New here?"
        case .createAccount:
            "Already have an account?"
        }
    }
}

enum EntryFlowProvider: String, Equatable {
    case email
    case google

    var title: String {
        switch self {
        case .email:
            "Email"
        case .google:
            "Google"
        }
    }
}

enum EntryFlowPlan: String, CaseIterable, Equatable, Identifiable {
    case free
    case pro
    case max

    var id: String { self.rawValue }

    var title: String {
        switch self {
        case .free:
            "Free"
        case .pro:
            "Pro"
        case .max:
            "Max"
        }
    }

    var eyebrow: String {
        switch self {
        case .free:
            "Start"
        case .pro:
            "Recommended"
        case .max:
            "Power"
        }
    }

    var summary: String {
        switch self {
        case .free:
            "Core access for one Mac."
        case .pro:
            "More headroom for everyday work."
        case .max:
            "Highest limits and fastest lane."
        }
    }

    var highlights: [String] {
        switch self {
        case .free:
            [
                "Native desktop workspace",
                "Email and Google sign-in",
                "Local memory and sessions",
            ]
        case .pro:
            [
                "Everything in Free",
                "Expanded daily usage limits",
                "Priority access as new surfaces ship",
            ]
        case .max:
            [
                "Everything in Pro",
                "Highest available ceilings",
                "Best fit for heavy daily operators",
            ]
        }
    }
}

enum EntryFlowScreen: String, Equatable, Identifiable {
    case welcome
    case signIn
    case createAccount
    case email
    case emailSent
    case code
    case google
    case terms
    case plan
    case name
    case completed

    var id: String { self.rawValue }
}

enum EntryFlowActivity: Equatable {
    case google
    case email
    case code
    case profile
}

struct EntryFlowDraft: Equatable {
    var email = ""
    var code = ""
    var displayName = ""
    var acceptedTerms = false
    var selectedPlan: EntryFlowPlan?
}

struct EntryFlowEmailDelivery: Equatable {
    let email: String
    let message: String
}

struct EntryFlowExternalAuthSession: Equatable {
    let provider: EntryFlowProvider
    let setupURL: URL?
    let title: String
    let message: String
}

struct EntryFlowProfileSeed: Equatable {
    let email: String
    let displayName: String?
    let selectedPlan: EntryFlowPlan?
}

enum EntryFlowAuthResolution: Equatable {
    case signedIn(email: String)
    case needsProfile(EntryFlowProfileSeed)
}

struct EntryFlowProfileSubmission: Equatable {
    let email: String
    let displayName: String
    let plan: EntryFlowPlan
    let termsAcceptedAt: Date
    let provider: EntryFlowProvider
    let origin: EntryFlowIntent
}

enum EntryFlowCompletion: Equatable {
    case signedIn(email: String)
    case accountCreated(displayName: String, plan: EntryFlowPlan)

    var title: String {
        switch self {
        case .signedIn:
            "You're signed in"
        case .accountCreated:
            "Your account is ready"
        }
    }

    var message: String {
        switch self {
        case let .signedIn(email):
            "This Mac is now linked to \(email)."
        case let .accountCreated(displayName, plan):
            "\(displayName) is ready on the \(plan.title) plan."
        }
    }
}

struct EntryFlowHandlers {
    let beginGoogleAuth: @MainActor (EntryFlowIntent) async throws -> EntryFlowExternalAuthSession
    let beginEmailAuth: @MainActor (String, EntryFlowIntent) async throws -> EntryFlowEmailDelivery
    let verifyEmailCode: @MainActor (String, String, EntryFlowIntent) async throws -> EntryFlowAuthResolution
    let completeProfile: @MainActor (EntryFlowProfileSubmission) async throws -> Void
}

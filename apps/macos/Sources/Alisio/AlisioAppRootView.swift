import AppKit
import Observation
import SwiftUI

import AlisioSupport

@MainActor
@Observable
final class AlisioAppRootState {
    enum SurfaceOverride {
        case automatic
        case entryFlow
        case setup
    }

    var surfaceOverride: SurfaceOverride = .automatic

    var prefersEntryFlow: Bool {
        self.surfaceOverride == .entryFlow
    }

    var prefersSetup: Bool {
        self.surfaceOverride == .setup
    }

    func showEntryFlow() {
        self.surfaceOverride = .entryFlow
    }

    func showSetup() {
        self.surfaceOverride = .setup
    }

    func showWorkspace() {
        self.surfaceOverride = .automatic
    }
}

enum AlisioAppRuntimeGateStatus: Equatable {
    case checking
    case blocked
    case ready

    init(runtimeState: MacSetupRuntimeState) {
        switch runtimeState {
        case .checking:
            self = .checking
        case .blocked:
            self = .blocked
        case .ready:
            self = .ready
        }
    }
}

@MainActor
enum AlisioAppVisibleSurface {
    case loading
    case entryFlow
    case setup
    case workspace
}

@MainActor
struct AlisioAppRootView: View {
    @Bindable var rootState: AlisioAppRootState
    @Bindable var navigationState: WorkspaceNavigationState
    @Bindable var state: AppState
    @Bindable private var accountStore = AlisioAccountStore.shared
    @State private var runtimeGateStatus: AlisioAppRuntimeGateStatus

    let presentation: AlisioWorkspacePresentation
    let updater: (any UpdaterProviding)?
    let chatEnvironment: AlisioWorkspaceChatEnvironment

    private let isPreview = ProcessInfo.processInfo.isPreview
    private let isRunningTests = ProcessInfo.processInfo.isRunningTests

    init(
        rootState: AlisioAppRootState,
        navigationState: WorkspaceNavigationState,
        state: AppState,
        presentation: AlisioWorkspacePresentation,
        updater: (any UpdaterProviding)?,
        chatEnvironment: AlisioWorkspaceChatEnvironment)
    {
        self.rootState = rootState
        self.navigationState = navigationState
        self.state = state
        self.presentation = presentation
        self.updater = updater
        self.chatEnvironment = chatEnvironment
        self._runtimeGateStatus = State(
            initialValue: AlisioAppRuntimeGateStatus(runtimeState: state.initialRuntimeReadinessState()))
    }

    var body: some View {
        Group {
            switch self.visibleSurface {
            case .workspace:
                AlisioWorkspaceRootView(
                    navigationState: self.navigationState,
                    state: self.state,
                    presentation: self.presentation,
                    updater: self.updater,
                    chatEnvironment: self.chatEnvironment)
            case .loading:
                AlisioEntryFlowRootView(
                    rootState: self.rootState,
                    state: self.state,
                    stage: .loading,
                    presentation: self.presentation)
            case .entryFlow:
                AlisioEntryFlowRootView(
                    rootState: self.rootState,
                    state: self.state,
                    stage: .entryFlow,
                    presentation: self.presentation)
            case .setup:
                AlisioEntryFlowRootView(
                    rootState: self.rootState,
                    state: self.state,
                    stage: .setup,
                    presentation: self.presentation)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task {
                await self.refreshAccount(reason: "app-root-active")
                await self.refreshRuntimeGate()
            }
        }
        .task(id: self.accountRefreshKey) {
            await self.refreshAccount(reason: "app-root")
        }
        .task(id: self.runtimeRefreshKey) {
            await self.refreshRuntimeGate()
        }
    }

    private var visibleSurface: AlisioAppVisibleSurface {
        Self.resolveVisibleSurface(
            needsInitialAccountRefresh: self.needsInitialAccountRefresh,
            prefersEntryFlow: self.rootState.prefersEntryFlow,
            isAuthenticated: self.accountStore.isAuthenticated,
            profileCompleted: self.accountStore.profileCompleted,
            prefersSetup: self.rootState.prefersSetup,
            runtimeGateStatus: self.runtimeGateStatus)
    }

    private var accountRefreshKey: String {
        "\(self.state.connectionMode.rawValue)-\(self.rootState.surfaceOverride)"
    }

    private var runtimeRefreshKey: String {
        [
            self.state.connectionMode.rawValue,
            self.state.remoteTransport.rawValue,
            self.state.remoteTarget,
            self.state.remoteIdentity,
            self.state.remoteUrl,
            self.state.remoteToken,
        ]
        .joined(separator: "|")
    }

    private var needsInitialAccountRefresh: Bool {
        guard !self.isPreview, !self.isRunningTests else { return false }
        return self.accountStore.snapshot == nil && self.accountStore.lastRefreshAt == nil
    }

    private func refreshAccount(reason: String) async {
        guard !self.isPreview, !self.isRunningTests else { return }
        await self.accountStore.refresh(reason: reason)
    }

    private func refreshRuntimeGate() async {
        let runtimeState = await self.state.refreshRuntimeReadinessState()
        guard !Task.isCancelled else { return }
        self.runtimeGateStatus = AlisioAppRuntimeGateStatus(runtimeState: runtimeState)
    }

    static func resolveVisibleSurface(
        needsInitialAccountRefresh: Bool,
        prefersEntryFlow: Bool,
        isAuthenticated: Bool,
        profileCompleted: Bool,
        prefersSetup: Bool,
        runtimeGateStatus: AlisioAppRuntimeGateStatus) -> AlisioAppVisibleSurface
    {
        if needsInitialAccountRefresh {
            return .loading
        }
        if prefersEntryFlow {
            return .entryFlow
        }
        if !isAuthenticated || !profileCompleted {
            return .entryFlow
        }
        if prefersSetup {
            return .setup
        }
        switch runtimeGateStatus {
        case .checking:
            return .loading
        case .blocked:
            return .setup
        case .ready:
            return .workspace
        }
    }
}

@MainActor
private enum AlisioEntryFlowStage {
    case loading
    case entryFlow
    case setup
}

@MainActor
private struct AlisioEntryFlowRootView: View {
    @Bindable var rootState: AlisioAppRootState
    @Bindable var state: AppState

    let stage: AlisioEntryFlowStage
    let presentation: AlisioWorkspacePresentation

    var body: some View {
        Group {
            if self.presentation.isPanel {
                self.panelBody
            } else {
                self.windowBody
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(NSColor.windowBackgroundColor).ignoresSafeArea())
    }

    private var windowBody: some View {
        Group {
            switch self.stage {
            case .loading:
                self.loadingStage
            case .entryFlow:
                AlisioEntryFlowHostView(rootState: self.rootState)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .setup:
                MacSetupView(state: self.state)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var panelBody: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: self.panelIconName)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 4) {
                    Text(self.panelTitle)
                        .font(.headline)
                    Text(self.panelMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Button("Open Mac setup") {
                AlisioWindowManager.shared.showSetup()
            }
            .buttonStyle(.borderedProminent)

            Spacer(minLength: 0)
        }
        .padding(22)
    }

    private var loadingStage: some View {
        VStack(spacing: 18) {
            AlisioOnboardingIcon()
            ProgressView()
                .controlSize(.large)
            Text("Preparing Alisio")
                .font(.title2.weight(.semibold))
            Text("Checking account and runtime state before opening the workspace.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }

    private var panelIconName: String {
        switch self.stage {
        case .loading:
            "hourglass"
        case .entryFlow:
            "person.crop.circle.badge.exclamationmark"
        case .setup:
            "sparkles.rectangle.stack"
        }
    }

    private var panelTitle: String {
        switch self.stage {
        case .loading:
            "Preparing Alisio"
        case .entryFlow:
            "Sign in required"
        case .setup:
            "Mac setup required"
        }
    }

    private var panelMessage: String {
        switch self.stage {
        case .loading:
            "The workspace will open after the account and setup state are ready."
        case .entryFlow:
            "Finish sign-in or account creation in the main window before using the panel."
        case .setup:
            "Finish Mac setup in the main window before using chat and workspace tools."
        }
    }
}

@MainActor
private struct AlisioEntryFlowHostView: View {
    @Bindable var rootState: AlisioAppRootState
    @Bindable private var accountStore = AlisioAccountStore.shared
    @State private var model = EntryFlowModel(handlers: Self.makeHandlers())

    var body: some View {
        EntryFlowView(
            model: self.model,
            legalLinks: EntryFlowLegalLinks(),
            onContinue: {
                self.rootState.showWorkspace()
            })
            .task {
                if !self.rootState.prefersEntryFlow {
                    self.rootState.showEntryFlow()
                }
            }
            .task(id: self.accountStore.lastAuthCompletionEventID) {
                guard let completion = self.accountStore.takeLastAuthCompletion() else { return }
                self.model.applyAuthenticationResolution(Self.authResolution(from: completion))
            }
    }

    private static func makeHandlers() -> EntryFlowHandlers {
        EntryFlowHandlers(
            beginGoogleAuth: { intent in
                let request = try await AlisioAccountStore.shared.beginGoogleAuth()
                _ = NSWorkspace.shared.open(request.setupURL)
                return EntryFlowExternalAuthSession(
                    provider: .google,
                    setupURL: request.setupURL,
                    title: intent == .createAccount ? "Create the account in your browser" : "Finish sign-in in your browser",
                    message: "The browser owns this Google step. Return to the Mac app through the callback link when it finishes.")
            },
            beginEmailAuth: { email, intent in
                let challenge = try await AlisioAccountStore.shared.beginEmailAuth(email: email)
                let message = if intent == .createAccount {
                    "Check \(challenge.email) for the sign-in link and backup code to keep creating the account on this Mac."
                } else {
                    "Check \(challenge.email) for the sign-in link and backup code for this Mac."
                }
                return EntryFlowEmailDelivery(email: challenge.email, message: message)
            },
            verifyEmailCode: { email, code, _ in
                let completion = try await AlisioAccountStore.shared.verifyEmailAuth(email: email, code: code)
                return Self.authResolution(from: completion)
            },
            completeProfile: { submission in
                try await AlisioAccountStore.shared.completeProfile(submission)
            })
    }

    private static func authResolution(from completion: AlisioAccountAuthCompletion) -> EntryFlowAuthResolution {
        let snapshot = completion.snapshot
        let email = snapshot.profile?.email?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? snapshot.resolvedAccountId
            ?? ""
        if snapshot.session?.profileCompleted == true {
            return .signedIn(email: email)
        }
        return .needsProfile(
            .init(
                email: email,
                displayName: snapshot.profile?.displayName,
                selectedPlan: Self.entryPlan(from: snapshot.profile?.plan)))
    }

    private static func entryPlan(from rawPlan: String?) -> EntryFlowPlan? {
        switch rawPlan?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "free", "free plan":
            .free
        case "plus", "plus plan", "pro", "pro plan":
            .pro
        case "max", "max plan":
            .max
        default:
            nil
        }
    }
}

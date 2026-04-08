import AppKit
import Observation
import AlisioDiscovery
import AlisioIPC
import SwiftUI

import AlisioSupport
enum UIStrings {
    static let welcomeTitle = "Welcome to Alisio"
}

enum RemoteOnboardingProbeState: Equatable {
    case idle
    case checking
    case ok(RemoteGatewayProbeSuccess)
    case failed(String)
}

@MainActor
final class OnboardingController {
    static let shared = OnboardingController()

    func show() {
        if ProcessInfo.processInfo.isNixMode {
            // Nix mode is fully declarative; onboarding would suggest interactive setup that doesn't apply.
            UserDefaults.standard.set(true, forKey: onboardingSeenKey)
            UserDefaults.standard.set(currentOnboardingVersion, forKey: onboardingVersionKey)
            AppStateStore.shared.onboardingSeen = true
            return
        }
        DockIconManager.shared.temporarilyShowDock()
        NSApp.activate(ignoringOtherApps: true)
        LumeWindowManager.shared.show(route: .onboarding)
    }

    func close() {}

    func restart() {
        self.show()
    }
}

struct OnboardingView: View {
    @State var currentPage = 0
    @State var monitoringPermissions = false
    @State var monitoringDiscovery = false
    @State var workspacePath: String = ""
    @State var showAdvancedConnection = false
    @State var preferredGatewayID: String?
    @State var remoteProbeState: RemoteOnboardingProbeState = .idle
    @State var remoteAuthIssue: RemoteGatewayAuthIssue?
    @State var suppressRemoteProbeReset = false
    @State var gatewayDiscovery: GatewayDiscoveryModel
    @State var onboardingSkillsModel = SkillsSettingsModel()
    @State var onboardingWizard = OnboardingWizardModel()
    @State var didLoadOnboardingSkills = false
    @State var localGatewayProbe: LocalGatewayProbe?
    @Bindable var state: AppState
    var permissionMonitor: PermissionMonitor
    var shellOnboarding: LumeOnboardingState?

    static let windowWidth: CGFloat = 630
    static let windowHeight: CGFloat = 752 // ~+10% to fit full onboarding content

    let pageWidth: CGFloat = Self.windowWidth
    let contentHeight: CGFloat = 460
    let connectionPageIndex = 1
    let wizardPageIndex = 3

    let permissionsPageIndex = 5
    static func pageOrder(for mode: AppState.ConnectionMode) -> [Int] {
        switch mode {
        case .remote:
            [0, 1, 5, 9]
        case .unconfigured:
            [0, 1, 9]
        case .local:
            [0, 1, 3, 5, 9]
        }
    }

    var pageOrder: [Int] {
        Self.pageOrder(for: self.state.connectionMode)
    }

    var pageCount: Int {
        self.pageOrder.count
    }

    var activePageIndex: Int {
        self.activePageIndex(for: self.currentPage)
    }

    var buttonTitle: String {
        self.currentPage == self.pageCount - 1 ? "Finish" : "Next"
    }

    var wizardPageOrderIndex: Int? {
        self.pageOrder.firstIndex(of: self.wizardPageIndex)
    }

    var isWizardBlocking: Bool {
        self.activePageIndex == self.wizardPageIndex && !self.onboardingWizard.isComplete
    }

    var canAdvance: Bool {
        !self.isWizardBlocking
    }

    var devLinkCommand: String {
        let version = GatewayEnvironment.expectedGatewayVersionString() ?? "latest"
        return "npm install -g alisio@npm:alisio@\(version)"
    }

    struct LocalGatewayProbe: Equatable {
        let port: Int
        let pid: Int32
        let command: String
        let expected: Bool
    }

    init(
        state: AppState = AppStateStore.shared,
        permissionMonitor: PermissionMonitor = .shared,
        discoveryModel: GatewayDiscoveryModel = GatewayDiscoveryModel(
            localDisplayName: InstanceIdentity.displayName,
            filterLocalGateways: false),
        shellOnboarding: LumeOnboardingState? = nil)
    {
        self.state = state
        self.permissionMonitor = permissionMonitor
        self._gatewayDiscovery = State(initialValue: discoveryModel)
        self.shellOnboarding = shellOnboarding
    }
}

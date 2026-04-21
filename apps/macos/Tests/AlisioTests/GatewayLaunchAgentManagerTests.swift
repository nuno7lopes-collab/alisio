import Testing
@testable import Alisio

struct GatewayLaunchAgentManagerTests {
    @Test
    func `session override disables launchd writes without persistence`() {
        #expect(
            GatewayLaunchAgentManager._testResolveLaunchAgentWriteDisabled(
                sessionDisabled: true,
                persistedDisabled: false))
        #expect(
            GatewayLaunchAgentManager._testResolveLaunchAgentWriteDisabled(
                sessionDisabled: false,
                persistedDisabled: true))
        #expect(
            !GatewayLaunchAgentManager._testResolveLaunchAgentWriteDisabled(
                sessionDisabled: false,
                persistedDisabled: false))
    }
}

import Testing
import AlisioSupport
@testable import Alisio

@MainActor
struct RemoteGatewayProbeTests {
    @Test func `auth detail codes map to remote auth issues`() {
        let tokenMissing = GatewayConnectAuthError(
            message: "token missing",
            detailCode: GatewayConnectAuthDetailCode.authTokenMissing.rawValue,
            canRetryWithDeviceToken: false)
        let tokenMismatch = GatewayConnectAuthError(
            message: "token mismatch",
            detailCode: GatewayConnectAuthDetailCode.authTokenMismatch.rawValue,
            canRetryWithDeviceToken: false)
        let tokenNotConfigured = GatewayConnectAuthError(
            message: "token not configured",
            detailCode: GatewayConnectAuthDetailCode.authTokenNotConfigured.rawValue,
            canRetryWithDeviceToken: false)
        let bootstrapInvalid = GatewayConnectAuthError(
            message: "setup code expired",
            detailCode: GatewayConnectAuthDetailCode.authBootstrapTokenInvalid.rawValue,
            canRetryWithDeviceToken: false)
        let passwordMissing = GatewayConnectAuthError(
            message: "password missing",
            detailCode: GatewayConnectAuthDetailCode.authPasswordMissing.rawValue,
            canRetryWithDeviceToken: false)
        let pairingRequired = GatewayConnectAuthError(
            message: "pairing required",
            detailCode: GatewayConnectAuthDetailCode.pairingRequired.rawValue,
            canRetryWithDeviceToken: false)
        let unknown = GatewayConnectAuthError(
            message: "other",
            detailCode: "SOMETHING_ELSE",
            canRetryWithDeviceToken: false)

        #expect(RemoteGatewayAuthIssue(error: tokenMissing) == .tokenRequired)
        #expect(RemoteGatewayAuthIssue(error: tokenMismatch) == .tokenMismatch)
        #expect(RemoteGatewayAuthIssue(error: tokenNotConfigured) == .gatewayTokenNotConfigured)
        #expect(RemoteGatewayAuthIssue(error: bootstrapInvalid) == .setupCodeExpired)
        #expect(RemoteGatewayAuthIssue(error: passwordMissing) == .passwordRequired)
        #expect(RemoteGatewayAuthIssue(error: pairingRequired) == .pairingRequired)
        #expect(RemoteGatewayAuthIssue(error: unknown) == nil)
    }

    @Test func `password detail family maps to password required issue`() {
        let mismatch = GatewayConnectAuthError(
            message: "password mismatch",
            detailCode: GatewayConnectAuthDetailCode.authPasswordMismatch.rawValue,
            canRetryWithDeviceToken: false)
        let notConfigured = GatewayConnectAuthError(
            message: "password not configured",
            detailCode: GatewayConnectAuthDetailCode.authPasswordNotConfigured.rawValue,
            canRetryWithDeviceToken: false)

        #expect(RemoteGatewayAuthIssue(error: mismatch) == .passwordRequired)
        #expect(RemoteGatewayAuthIssue(error: notConfigured) == .passwordRequired)
    }

    @Test func `pairing required copy points users to pair approve`() {
        let issue = RemoteGatewayAuthIssue.pairingRequired

        #expect(issue.title == "This device needs pairing approval")
        #expect(issue.body.contains("`/pair approve`"))
        #expect(issue.statusMessage.contains("/pair approve"))
        #expect(issue.footnote?.contains("`alisio devices approve`") == true)
    }

    @Test func `paired device success copy explains auth source`() {
        let pairedDevice = RemoteGatewayProbeSuccess(authSource: .deviceToken)
        let bootstrap = RemoteGatewayProbeSuccess(authSource: .bootstrapToken)
        let sharedToken = RemoteGatewayProbeSuccess(authSource: .sharedToken)
        let noAuth = RemoteGatewayProbeSuccess(authSource: GatewayAuthSource.none)

        #expect(pairedDevice.title == "Connected via paired device")
        #expect(pairedDevice.detail == "This Mac used a stored device token. New or unpaired devices may still need a fresh connection token.")
        #expect(bootstrap.title == "Connected with setup code")
        #expect(bootstrap.detail == "This Mac is still using the temporary setup code. Approve pairing to finish provisioning device-scoped auth.")
        #expect(sharedToken.title == "Connected with connection token")
        #expect(sharedToken.detail == nil)
        #expect(noAuth.title == "Remote gateway ready")
        #expect(noAuth.detail == nil)
    }
}

import Foundation
import ConcurrencyExtras
import Testing
import AlisioSupport
@testable import Alisio

@MainActor
struct AlisioWorkspaceURLTests {
    @Test func `local resolve waits for gateway readiness before building chat url`() async throws {
        let state = AppState(preview: true)
        state.connectionMode = .local
        let shellState = AlisioShellState()
        let calls = LockIsolated<[String]>([])

        let url = try await AlisioWorkspaceURL.resolve(
            shellState: shellState,
            appState: state,
            deps: .init(
                ensureLocalGatewayReady: { timeout in
                    calls.withValue { $0.append("ensure:\(Int(timeout))") }
                },
                requireConfig: {
                    calls.withValue { $0.append("config") }
                    return (URL(string: "ws://127.0.0.1:40705")!, nil, nil)
                }))

        #expect(calls.value == ["ensure:12", "config"])
        #expect(url.absoluteString == "http://127.0.0.1:40705/chat")
    }

    @Test func `remote resolve skips local gateway readiness checks`() async throws {
        let state = AppState(preview: true)
        state.connectionMode = .remote
        let shellState = AlisioShellState()
        let readinessChecks = LockIsolated(0)

        let url = try await AlisioWorkspaceURL.resolve(
            shellState: shellState,
            appState: state,
            deps: .init(
                ensureLocalGatewayReady: { _ in
                    readinessChecks.withValue { $0 += 1 }
                },
                requireConfig: {
                    (URL(string: "wss://gateway.example/control/")!, "remote-token", nil)
                }))

        #expect(readinessChecks.value == 0)
        #expect(url.absoluteString == "https://gateway.example/control/chat#token=remote-token")
    }

    @Test func `local resolve surfaces gateway readiness failures`() async {
        let state = AppState(preview: true)
        state.connectionMode = .local
        let shellState = AlisioShellState()

        do {
            _ = try await AlisioWorkspaceURL.resolve(
                shellState: shellState,
                appState: state,
                deps: .init(
                    ensureLocalGatewayReady: { _ in
                        throw NSError(
                            domain: "Gateway",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "gateway failed test"])
                    },
                    requireConfig: {
                        Issue.record("requireConfig should not run when readiness fails")
                        return (URL(string: "ws://127.0.0.1:40705")!, nil, nil)
                    }))
            Issue.record("Expected readiness failure")
        } catch {
            #expect(error.localizedDescription == "gateway failed test")
        }
    }
}

import Foundation
import Testing
import AlisioSupport
@testable import Alisio

@Suite(.serialized)
struct SessionDataTests {
    @Test @MainActor func `session loader requires signed in account`() async {
        await TestIsolation.withSignedOutAccount {
            do {
                _ = try await SessionLoader.loadSnapshot(limit: 1)
                Issue.record("Expected signed-out session load to throw")
            } catch let error as AlisioAccountRequiredError {
                #expect(error == .signedOut)
            } catch {
                Issue.record("Unexpected error type: \(error.localizedDescription)")
            }
        }
    }

    @Test func `session kind from key detects common kinds`() {
        #expect(SessionKind.from(key: "global") == .global)
        #expect(SessionKind.from(key: "discord:group:engineering") == .group)
        #expect(SessionKind.from(key: "unknown") == .unknown)
        #expect(SessionKind.from(key: "user@example.com") == .direct)
    }

    @Test func `session token stats format K tokens rounds as expected`() {
        #expect(SessionTokenStats.formatKTokens(999) == "999")
        #expect(SessionTokenStats.formatKTokens(1000) == "1.0k")
        #expect(SessionTokenStats.formatKTokens(12340) == "12k")
    }

    @Test func `session token stats percent used clamps to100`() {
        let stats = SessionTokenStats(input: 0, output: 0, total: 250_000, contextTokens: 200_000)
        #expect(stats.percentUsed == 100)
    }

    @Test func `session row flag labels include non default flags`() {
        let row = SessionRow(
            id: "x",
            key: "user@example.com",
            kind: .direct,
            labelOverride: nil,
            displayName: nil,
            derivedTitle: nil,
            lastMessagePreview: nil,
            subject: nil,
            room: nil,
            space: nil,
            updatedAt: Date(),
            sessionId: nil,
            thinkingLevel: "high",
            verboseLevel: "debug",
            systemSent: true,
            abortedLastRun: true,
            tokens: SessionTokenStats(input: 1, output: 2, total: 3, contextTokens: 10),
            model: nil)
        #expect(row.flagLabels.contains("think high"))
        #expect(row.flagLabels.contains("verbose debug"))
        #expect(row.flagLabels.contains("system sent"))
        #expect(row.flagLabels.contains("aborted"))
    }

    @Test func `session row label prefers derived title and exposes preview text`() {
        let row = SessionRow(
            id: "x",
            key: "agent:main:dashboard:child",
            kind: .direct,
            labelOverride: "Fallback Label",
            displayName: "Display Name",
            derivedTitle: "Derived Title",
            lastMessagePreview: "Most recent reply",
            subject: "Subject",
            room: nil,
            space: nil,
            updatedAt: nil,
            sessionId: nil,
            thinkingLevel: nil,
            verboseLevel: nil,
            systemSent: false,
            abortedLastRun: false,
            tokens: SessionTokenStats(input: 0, output: 0, total: 0, contextTokens: 0),
            model: nil)
        #expect(row.label == "Derived Title")
        #expect(row.previewText == "Most recent reply")
    }
}

import Foundation
import SwabbleKit
import Testing
@testable import Alisio

private let alisioTranscript = "hey alisio do thing"

private func alisioSegments(postTriggerStart: TimeInterval) -> [WakeWordSegment] {
    makeSegments(
        transcript: alisioTranscript,
        words: [
            ("hey", 0.0, 0.1),
            ("alisio", 0.2, 0.1),
            ("do", postTriggerStart, 0.1),
            ("thing", postTriggerStart + 0.2, 0.1),
        ])
}

@Suite struct VoiceWakeManagerExtractCommandTests {
    @Test func extractCommandReturnsNilWhenNoTriggerFound() {
        let transcript = "hello world"
        let segments = makeSegments(
            transcript: transcript,
            words: [("hello", 0.0, 0.1), ("world", 0.2, 0.1)])
        #expect(VoiceWakeManager.extractCommand(from: transcript, segments: segments, triggers: ["alisio"]) == nil)
    }

    @Test func extractCommandTrimsTokensAndResult() {
        let segments = alisioSegments(postTriggerStart: 0.9)
        let cmd = VoiceWakeManager.extractCommand(
            from: alisioTranscript,
            segments: segments,
            triggers: ["  alisio  "],
            minPostTriggerGap: 0.3)
        #expect(cmd == "do thing")
    }

    @Test func extractCommandReturnsNilWhenGapTooShort() {
        let segments = alisioSegments(postTriggerStart: 0.35)
        let cmd = VoiceWakeManager.extractCommand(
            from: alisioTranscript,
            segments: segments,
            triggers: ["alisio"],
            minPostTriggerGap: 0.3)
        #expect(cmd == nil)
    }

    @Test func extractCommandReturnsNilWhenNothingAfterTrigger() {
        let transcript = "hey alisio"
        let segments = makeSegments(
            transcript: transcript,
            words: [("hey", 0.0, 0.1), ("alisio", 0.2, 0.1)])
        #expect(VoiceWakeManager.extractCommand(from: transcript, segments: segments, triggers: ["alisio"]) == nil)
    }

    @Test func extractCommandIgnoresEmptyTriggers() {
        let segments = alisioSegments(postTriggerStart: 0.9)
        let cmd = VoiceWakeManager.extractCommand(
            from: alisioTranscript,
            segments: segments,
            triggers: ["", "   ", "alisio"],
            minPostTriggerGap: 0.3)
        #expect(cmd == "do thing")
    }
}

private func makeSegments(
    transcript: String,
    words: [(String, TimeInterval, TimeInterval)])
-> [WakeWordSegment] {
    var searchStart = transcript.startIndex
    var output: [WakeWordSegment] = []
    for (word, start, duration) in words {
        let range = transcript.range(of: word, range: searchStart..<transcript.endIndex)
        output.append(WakeWordSegment(text: word, start: start, duration: duration, range: range))
        if let range { searchStart = range.upperBound }
    }
    return output
}

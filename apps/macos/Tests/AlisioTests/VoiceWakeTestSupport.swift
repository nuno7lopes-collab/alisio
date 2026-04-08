import Foundation
import SwabbleKit

import AlisioSupport
func makeWakeWordSegments(
    transcript: String,
    words: [(String, TimeInterval, TimeInterval)])
-> [WakeWordSegment] {
    var cursor = transcript.startIndex
    return words.map { word, start, duration in
        let range = transcript.range(of: word, range: cursor..<transcript.endIndex)
        if let range {
            cursor = range.upperBound
        }
        return WakeWordSegment(text: word, start: start, duration: duration, range: range)
    }
}

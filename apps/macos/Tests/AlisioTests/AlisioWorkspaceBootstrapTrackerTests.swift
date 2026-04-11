import Foundation
import Testing
@testable import Alisio

struct AlisioWorkspaceBootstrapTrackerTests {
    @Test func `ready workspace does not reload the same url`() {
        var tracker = AlisioWorkspaceBootstrapTracker()
        let url = URL(string: "http://127.0.0.1:40705/chat")!

        let initialLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: nil)
        #expect(initialLoad)
        tracker.noteReady()

        let skippedReload = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: url)
        #expect(!skippedReload)
    }

    @Test func `same url reloads after fallback`() {
        var tracker = AlisioWorkspaceBootstrapTracker(retryDelays: [])
        let url = URL(string: "http://127.0.0.1:40705/chat")!
        let blank = URL(string: "about:blank")!

        let initialLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: nil)
        let outcome = tracker.noteFailure()

        #expect(initialLoad)
        #expect(outcome == .showFallback(url: url))
        let reloadAfterFallback = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: blank)
        #expect(reloadAfterFallback)
    }

    @Test func `failures retry before falling back`() {
        var tracker = AlisioWorkspaceBootstrapTracker(retryDelays: [1, 2])
        let url = URL(string: "http://127.0.0.1:40705/chat")!
        let blank = URL(string: "about:blank")!

        let initialLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: nil)
        let firstFailure = tracker.noteFailure()

        let secondLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: blank)
        let secondFailure = tracker.noteFailure()

        let thirdLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: blank)
        let finalFailure = tracker.noteFailure()

        #expect(initialLoad)
        #expect(firstFailure == .retry(url: url, attempt: 1, delayNanoseconds: 1))
        #expect(secondLoad)
        #expect(secondFailure == .retry(url: url, attempt: 2, delayNanoseconds: 2))
        #expect(thirdLoad)
        #expect(finalFailure == .showFallback(url: url))
        #expect(tracker.resolvedURL == nil)
    }

    @Test func `ready state resets retry budget`() {
        var tracker = AlisioWorkspaceBootstrapTracker(retryDelays: [1, 2])
        let url = URL(string: "http://127.0.0.1:40705/chat")!
        let blank = URL(string: "about:blank")!

        let initialLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: nil)
        let firstFailure = tracker.noteFailure()

        let secondLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: blank)
        tracker.noteReady()

        let thirdLoad = tracker.shouldLoad(resolvedURL: url, currentWebViewURL: blank)
        let failureAfterReady = tracker.noteFailure()

        #expect(initialLoad)
        #expect(firstFailure == .retry(url: url, attempt: 1, delayNanoseconds: 1))
        #expect(secondLoad)
        #expect(thirdLoad)
        #expect(failureAfterReady == .retry(url: url, attempt: 1, delayNanoseconds: 1))
    }
}

import Foundation

enum AlisioWorkspaceBootstrapFailureOutcome: Equatable {
    case retry(url: URL, attempt: Int, delayNanoseconds: UInt64)
    case showFallback(url: URL?)
}

struct AlisioWorkspaceBootstrapTracker {
    private(set) var resolvedURL: URL?
    private(set) var readyURL: URL?
    private(set) var awaitingReady = false
    private(set) var showingFallback = false

    private var retryCount = 0
    let retryDelays: [UInt64]

    init(retryDelays: [UInt64] = [500_000_000, 1_500_000_000, 3_000_000_000]) {
        self.retryDelays = retryDelays
    }

    var retryBudget: Int {
        self.retryDelays.count
    }

    mutating func shouldLoad(resolvedURL url: URL, currentWebViewURL: URL?) -> Bool {
        let sameResolvedURL = self.resolvedURL?.absoluteString == url.absoluteString
        if sameResolvedURL && self.awaitingReady {
            return false
        }

        let currentMatchesResolved = currentWebViewURL?.absoluteString == url.absoluteString
        let readyMatchesResolved = self.readyURL?.absoluteString == url.absoluteString
        if sameResolvedURL && readyMatchesResolved && currentMatchesResolved && !self.showingFallback {
            return false
        }

        if !sameResolvedURL {
            self.retryCount = 0
        }
        self.resolvedURL = url
        self.awaitingReady = true
        self.showingFallback = false
        return true
    }

    mutating func noteNavigationStarted() {
        if self.resolvedURL != nil {
            self.awaitingReady = true
        }
    }

    mutating func noteReady() {
        self.readyURL = self.resolvedURL
        self.awaitingReady = false
        self.showingFallback = false
        self.retryCount = 0
    }

    mutating func noteFailure() -> AlisioWorkspaceBootstrapFailureOutcome {
        self.awaitingReady = false
        self.readyURL = nil

        guard let url = self.resolvedURL else {
            self.showingFallback = true
            return .showFallback(url: nil)
        }

        if self.retryCount < self.retryDelays.count {
            let attempt = self.retryCount + 1
            let delay = self.retryDelays[self.retryCount]
            self.retryCount = attempt
            return .retry(url: url, attempt: attempt, delayNanoseconds: delay)
        }

        self.showingFallback = true
        self.resolvedURL = nil
        self.retryCount = 0
        return .showFallback(url: url)
    }

    mutating func noteResolveError() {
        self.resolvedURL = nil
        self.readyURL = nil
        self.awaitingReady = false
        self.showingFallback = true
        self.retryCount = 0
    }
}

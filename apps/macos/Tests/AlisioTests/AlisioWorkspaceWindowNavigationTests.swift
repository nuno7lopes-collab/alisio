import Foundation
import Testing

@testable import Alisio

struct AlisioWorkspaceWindowNavigationTests {
    @Test func `keeps noVNC subframe navigations inside the workspace`() {
        let currentURL = URL(string: "http://127.0.0.1:40705/chat")!
        let targetURL = URL(string: "http://127.0.0.1:32772/vnc.html#autoconnect=1")!

        #expect(
            shouldKeepWorkspaceNavigationInsideApp(
                currentURL: currentURL,
                targetURL: targetURL,
                isMainFrame: false))
    }

    @Test func `still externalizes foreign main-frame navigations`() {
        let currentURL = URL(string: "http://127.0.0.1:40705/chat")!
        let targetURL = URL(string: "https://www.google.com/")!

        #expect(
            !shouldKeepWorkspaceNavigationInsideApp(
                currentURL: currentURL,
                targetURL: targetURL,
                isMainFrame: true))
    }
}

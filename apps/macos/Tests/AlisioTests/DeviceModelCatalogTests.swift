import Testing
import AlisioSupport
@testable import Alisio

struct DeviceModelCatalogTests {
    @Test
    func `symbol prefers mac model identifier prefixes`() {
        #expect(DeviceModelCatalog
            .symbol(deviceFamily: "Mac", modelIdentifier: "MacBookPro18,1", friendlyName: nil) == "laptopcomputer")
        #expect(DeviceModelCatalog
            .symbol(deviceFamily: "Mac", modelIdentifier: "MacStudio1,1", friendlyName: nil) == "macstudio")
    }

    @Test
    func `symbol uses friendly name for mac variants`() {
        #expect(DeviceModelCatalog.symbol(
            deviceFamily: "Mac",
            modelIdentifier: "Mac99,1",
            friendlyName: "Mac Studio (2025)") == "macstudio")
        #expect(DeviceModelCatalog.symbol(
            deviceFamily: "Mac",
            modelIdentifier: "Mac99,2",
            friendlyName: "Mac mini (2024)") == "macmini")
        #expect(DeviceModelCatalog.symbol(
            deviceFamily: "Mac",
            modelIdentifier: "Mac99,3",
            friendlyName: "MacBook Pro (14-inch, 2024)") == "laptopcomputer")
    }

    @Test
    func `symbol falls back to device family`() {
        #expect(DeviceModelCatalog.symbol(deviceFamily: "Unknown", modelIdentifier: "", friendlyName: nil) == "cpu")
        #expect(DeviceModelCatalog.symbol(deviceFamily: "Linux", modelIdentifier: "", friendlyName: nil) == "cpu")
    }

    @Test
    func `presentation uses bundled mac model mappings`() {
        let presentation = DeviceModelCatalog.presentation(deviceFamily: "Mac", modelIdentifier: "Mac14,10")
        #expect(presentation?.title.isEmpty == false)
    }
}

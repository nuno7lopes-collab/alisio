// swift-tools-version: 6.2
// Package manifest for the Alisio macOS companion (menu bar app + IPC library).

import PackageDescription

let sharedPackageName = "AlisioKit"
let sharedProtocolModule = "AlisioProtocol"
let sharedChatUIModule = "AlisioChatUI"
let sharedPackagePath = "../shared/AlisioKit"

let package = Package(
    name: "Alisio",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "AlisioIPC", targets: ["AlisioIPC"]),
        .library(name: "AlisioDiscovery", targets: ["AlisioDiscovery"]),
        .executable(name: "Alisio", targets: ["Alisio"]),
        .executable(name: "alisio-mac", targets: ["AlisioMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.4.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.10.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.9.0"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: sharedPackagePath),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "AlisioSupport",
            dependencies: [
                .product(name: sharedPackageName, package: sharedPackageName),
                .product(name: sharedChatUIModule, package: sharedPackageName),
                .product(name: sharedProtocolModule, package: sharedPackageName),
            ],
            path: "Sources/AlisioSupport",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ],
            plugins: [
                "AlisioSupportExportsPlugin",
            ]),
        .target(
            name: "AlisioIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlisioDiscovery",
            dependencies: [
                "AlisioSupport",
            ],
            path: "Sources/AlisioDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Alisio",
            dependencies: [
                "AlisioIPC",
                "AlisioDiscovery",
                "AlisioSupport",
                .product(name: sharedPackageName, package: sharedPackageName),
                .product(name: sharedChatUIModule, package: sharedPackageName),
                .product(name: sharedProtocolModule, package: sharedPackageName),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Alisio.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "AlisioMacCLI",
            dependencies: [
                "AlisioDiscovery",
                "AlisioSupport",
            ],
            path: "Sources/AlisioMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "AlisioTests",
            dependencies: [
                "AlisioIPC",
                "Alisio",
                "AlisioDiscovery",
                "AlisioSupport",
                .product(name: sharedPackageName, package: sharedPackageName),
                .product(name: sharedChatUIModule, package: sharedPackageName),
                .product(name: sharedProtocolModule, package: sharedPackageName),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            path: "Tests/AlisioTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
        .executableTarget(
            name: "AlisioSupportExportsTool",
            path: "Tools/AlisioSupportExportsTool",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .plugin(
            name: "AlisioSupportExportsPlugin",
            capability: .buildTool(),
            dependencies: [
                "AlisioSupportExportsTool",
            ],
            path: "Plugins/AlisioSupportExportsPlugin"),
    ])

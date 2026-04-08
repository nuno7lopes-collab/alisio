// swift-tools-version: 6.2
// Canonical shared package surface during the OpenClawKit -> AlisioKit transition.

import PackageDescription

let legacySharedPackageName = "OpenClawKit"
let legacySharedPackagePath = "../OpenClawKit"

let package = Package(
    name: "AlisioKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AlisioProtocol", targets: ["AlisioProtocol"]),
        .library(name: "AlisioKit", targets: ["AlisioKit"]),
        .library(name: "AlisioChatUI", targets: ["AlisioChatUI"]),
    ],
    dependencies: [
        .package(path: legacySharedPackagePath),
    ],
    targets: [
        .target(
            name: "AlisioProtocol",
            dependencies: [
                .product(name: "OpenClawProtocol", package: legacySharedPackageName),
            ],
            path: "Sources/AlisioProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlisioKit",
            dependencies: [
                "AlisioProtocol",
                .product(name: "OpenClawKit", package: legacySharedPackageName),
            ],
            path: "Sources/AlisioKit",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlisioChatUI",
            dependencies: [
                "AlisioKit",
                .product(name: "OpenClawChatUI", package: legacySharedPackageName),
            ],
            path: "Sources/AlisioChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "AlisioKitTests",
            dependencies: [
                "AlisioProtocol",
                "AlisioKit",
                "AlisioChatUI",
                .product(name: "OpenClawProtocol", package: legacySharedPackageName),
                .product(name: "OpenClawKit", package: legacySharedPackageName),
                .product(name: "OpenClawChatUI", package: legacySharedPackageName),
            ],
            path: "Tests/AlisioKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])

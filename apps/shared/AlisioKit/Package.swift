// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AlisioKit",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "AlisioProtocol", targets: ["AlisioProtocol"]),
        .library(name: "AlisioKit", targets: ["AlisioKit"]),
        .library(name: "AlisioChatUI", targets: ["AlisioChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.1"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.5.0"),
    ],
    targets: [
        .target(
            name: "AlisioProtocol",
            path: "Sources/AlisioProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlisioKit",
            dependencies: [
                "AlisioProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/AlisioKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "AlisioChatUI",
            dependencies: [
                "AlisioKit",
                .product(
                    name: "Textual",
                    package: "textual"),
            ],
            path: "Sources/AlisioChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "AlisioKitTests",
            dependencies: ["AlisioKit", "AlisioChatUI"],
            path: "Tests/AlisioKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])

import Foundation

enum GeneratorError: Error {
    case missingOutputFile
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    throw GeneratorError.missingOutputFile
}

let fileManager = FileManager.default
let outputFile = URL(fileURLWithPath: arguments[1], isDirectory: false)
let outputDirectory = outputFile.deletingLastPathComponent()
try fileManager.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

let legacyBase = "Open" + "Claw"
let kitModule = legacyBase + "Kit"
let protocolModule = legacyBase + "Protocol"
let chatModule = legacyBase + "ChatUI"

func emitTypealias(_ lhs: String, _ rhs: String, indent: String = "") -> String {
    "\(indent)public typealias \(lhs) = \(rhs)"
}

let enumKitAliases = [
    "AnyCodable",
    "InstanceIdentity",
    "AsyncTimeout",
    "BonjourEscapes",
    "BonjourServiceResolverSupport",
    "GatewayDiscoveryBrowserSupport",
    "GatewayDiscoveryStatusText",
    "GatewayEndpointID",
    "NetworkInterfaceIPv4",
    "GatewayPayloadDecoding",
    "GatewayPush",
    "ToolDisplayRegistry",
    "WebSocketSessionBox",
    "WebViewJavaScriptSupport",
]

let topLevelBaseAliases: [(String, String)] = [
    ("AlisioBrowserCommand", "BrowserCommand"),
    ("AlisioCameraClipParams", "CameraClipParams"),
    ("AlisioCameraCommand", "CameraCommand"),
    ("AlisioCameraSnapParams", "CameraSnapParams"),
    ("AlisioCanvasA2UIAction", "CanvasA2UIAction"),
    ("AlisioCanvasA2UICommand", "CanvasA2UICommand"),
    ("AlisioCanvasA2UIJSONL", "CanvasA2UIJSONL"),
    ("AlisioCanvasA2UIPushJSONLParams", "CanvasA2UIPushJSONLParams"),
    ("AlisioCanvasA2UIPushParams", "CanvasA2UIPushParams"),
    ("AlisioCanvasCommand", "CanvasCommand"),
    ("AlisioCanvasEvalParams", "CanvasEvalParams"),
    ("AlisioCanvasNavigateParams", "CanvasNavigateParams"),
    ("AlisioCanvasPresentParams", "CanvasPresentParams"),
    ("AlisioCanvasSnapshotFormat", "CanvasSnapshotFormat"),
    ("AlisioCanvasSnapshotParams", "CanvasSnapshotParams"),
    ("AlisioCapability", "Capability"),
    ("AlisioChatAttachmentPayload", "ChatAttachmentPayload"),
    ("AlisioChatHistoryPayload", "ChatHistoryPayload"),
    ("AlisioChatMessage", "ChatMessage"),
    ("AlisioChatSendResponse", "ChatSendResponse"),
    ("AlisioGatewayHealthOK", "GatewayHealthOK"),
    ("AlisioKitResources", "KitResources"),
    ("AlisioLocationAccuracy", "LocationAccuracy"),
    ("AlisioLocationCommand", "LocationCommand"),
    ("AlisioLocationGetParams", "LocationGetParams"),
    ("AlisioLocationMode", "LocationMode"),
    ("AlisioLocationPayload", "LocationPayload"),
    ("AlisioNodeError", "NodeError"),
    ("AlisioNodeErrorCode", "NodeErrorCode"),
    ("AlisioSessionPreviewEntry", "SessionPreviewEntry"),
    ("AlisioSessionsPreviewPayload", "SessionsPreviewPayload"),
    ("AlisioSystemCommand", "SystemCommand"),
    ("AlisioSystemNotifyParams", "SystemNotifyParams"),
    ("AlisioSystemRunParams", "SystemRunParams"),
    ("AlisioSystemWhichParams", "SystemWhichParams"),
]

let topLevelKitAliases = [
    ("GatewayPayloadDecoding", "GatewayPayloadDecoding"),
    ("GatewayPush", "GatewayPush"),
    ("ToolDisplayRegistry", "ToolDisplayRegistry"),
    ("WebSocketSessionBox", "WebSocketSessionBox"),
    ("WebViewJavaScriptSupport", "WebViewJavaScriptSupport"),
    ("AsyncTimeout", "AsyncTimeout"),
    ("BonjourEscapes", "BonjourEscapes"),
    ("BonjourServiceResolverSupport", "BonjourServiceResolverSupport"),
    ("GatewayDiscoveryBrowserSupport", "GatewayDiscoveryBrowserSupport"),
    ("GatewayDiscoveryStatusText", "GatewayDiscoveryStatusText"),
    ("GatewayEndpointID", "GatewayEndpointID"),
    ("NetworkInterfaceIPv4", "NetworkInterfaceIPv4"),
    ("KitAnyCodable", "AnyCodable"),
]

let topLevelProtocolAliases = [
    ("ConfigSchemaResponse", "ConfigSchemaResponse"),
    ("ProtoAnyCodable", "AnyCodable"),
]

var lines: [String] = [
    "@_exported import \(chatModule)",
    "@_exported import \(kitModule)",
    "@_exported import \(protocolModule)",
    "",
    "public enum AlisioProtocol {",
    emitTypealias("AnyCodable", "\(protocolModule).AnyCodable", indent: "    "),
    "}",
    "",
    "public enum AlisioKit {",
]

lines.append(contentsOf: enumKitAliases.map {
    emitTypealias($0, "\(kitModule).\($0)", indent: "    ")
})

lines.append("}")
lines.append("")

lines.append(contentsOf: topLevelBaseAliases.map {
    emitTypealias($0.0, "\(legacyBase)\($0.1)")
})

lines.append(contentsOf: topLevelKitAliases.map {
    emitTypealias($0.0, "\(kitModule).\($0.1)")
})

lines.append(contentsOf: topLevelProtocolAliases.map {
    emitTypealias($0.0, "\(protocolModule).\($0.1)")
})

lines.append("")
let contents = lines.joined(separator: "\n")

if fileManager.fileExists(atPath: outputFile.path) {
    let existing = try String(contentsOf: outputFile, encoding: .utf8)
    if existing == contents {
        exit(0)
    }
}

try contents.write(to: outputFile, atomically: true, encoding: .utf8)

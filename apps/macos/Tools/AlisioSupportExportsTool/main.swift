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

let kitModule = "AlisioKit"
let protocolModule = "AlisioProtocol"
let chatModule = "AlisioChatUI"

var lines: [String] = [
    "@_exported import \(chatModule)",
    "@_exported import \(kitModule)",
    "@_exported import \(protocolModule)",
]
let contents = lines.joined(separator: "\n")

if fileManager.fileExists(atPath: outputFile.path) {
    let existing = try String(contentsOf: outputFile, encoding: .utf8)
    if existing == contents {
        exit(0)
    }
}

try contents.write(to: outputFile, atomically: true, encoding: .utf8)

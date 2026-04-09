import Foundation

public enum AlisioBrand {
    public static let displayName = "Alisio"
    public static let executableName = "Alisio"
    public static let bundleIdentifier = "ai.alisio.mac"
    public static let debugBundleIdentifier = bundleIdentifier + ".debug"
    public static let deepLinkIdentifier = bundleIdentifier + ".deeplink"
    public static let installHost = "alisio.pt"
    public static let installCLIURL = "https://\(installHost)/install-cli.sh"
    public static let gatewayClientIdentifier = "alisio-macos"
    public static let logSubsystem = bundleIdentifier
    public static let defaultsPrefix = "alisio."
    public static let stateDirectoryName = ".alisio"
    public static let configFileName = "alisio.json"
    public static let commandName = "alisio"
    public static let macCommandName = "alisio-mac"
    public static let bundledPackageDirectoryName = "alisio-package"
    public static let projectRootDirectoryName = "alisio"
    public static let launchdLabel = bundleIdentifier
    // Keep the gateway LaunchAgent label aligned with the daemon/CLI contract instead of
    // deriving it from the app bundle identifier.
    public static let gatewayLaunchdLabel = "ai.alisio.gateway"
    public static let configPathEnv = "ALISIO_CONFIG_PATH"
    public static let stateDirEnv = "ALISIO_STATE_DIR"
    public static let nixModeEnv = "ALISIO_NIX_MODE"

    public static func subsystem(_ suffix: String) -> String {
        "\(bundleIdentifier).\(suffix)"
    }
}

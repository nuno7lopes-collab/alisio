import Foundation

public enum AlisioBrand {
    public static let displayName = "Alisio"
    public static let executableName = "Alisio"
    public static let bundleIdentifier = "ai.alisio.mac"
    public static let debugBundleIdentifier = bundleIdentifier + ".debug"
    public static let deepLinkIdentifier = bundleIdentifier + ".deeplink"
    public static let installHost = "alisio.pt"
    public static let installCLIURL = "https://\(installHost)/install-cli.sh"
    // The gateway protocol still keys macOS app auth and policy off the canonical client id.
    public static let gatewayClientIdentifier = "openclaw-macos"
    public static let logSubsystem = bundleIdentifier
    public static let defaultsPrefix = "alisio."
    public static let stateDirectoryName = ".alisio"
    public static let configFileName = "alisio.json"
    public static let commandName = "alisio"
    public static let macCommandName = "alisio-mac"
    public static let bundledPackageDirectoryName = "alisio-package"
    public static let projectRootDirectoryName = "alisio"
    public static let launchdLabel = bundleIdentifier
    public static let gatewayLaunchdLabel = "\(bundleIdentifier).gateway"
    public static let configPathEnv = "ALISIO_CONFIG_PATH"
    public static let stateDirEnv = "ALISIO_STATE_DIR"
    public static let nixModeEnv = "ALISIO_NIX_MODE"

    public static func subsystem(_ suffix: String) -> String {
        "\(bundleIdentifier).\(suffix)"
    }
}

public enum LegacyBrand {
    private static let capitalized = ["Open", "Claw"].joined()
    public static let lowercased = capitalized.lowercased()
    public static let defaultsPrefix = lowercased + "."
    public static let stateDirectoryName = "." + lowercased
    public static let configFileName = lowercased + ".json"
    public static let commandName = lowercased
    public static let bundledPackageDirectoryName = lowercased + "-package"
    public static let macCommandName = lowercased + "-mac"
    public static let projectRootDirectoryName = lowercased
    public static let configPathEnv = lowercased.uppercased() + "_CONFIG_PATH"
    public static let stateDirEnv = lowercased.uppercased() + "_STATE_DIR"
    public static let nixModeEnv = lowercased.uppercased() + "_NIX_MODE"
    public static let launchdLabel = ["ai", lowercased, "mac"].joined(separator: ".")
    public static let gatewayLaunchdLabel = ["ai", lowercased, "gateway"].joined(separator: ".")
    public static let installHost = lowercased + ".bot"
}

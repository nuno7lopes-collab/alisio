import Foundation

public enum AlisioDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum AlisioBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum AlisioThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum AlisioNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum AlisioNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct AlisioBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: AlisioBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: AlisioBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct AlisioThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: AlisioThermalState

    public init(state: AlisioThermalState) {
        self.state = state
    }
}

public struct AlisioStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct AlisioNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: AlisioNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [AlisioNetworkInterfaceType]

    public init(
        status: AlisioNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [AlisioNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct AlisioDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: AlisioBatteryStatusPayload
    public var thermal: AlisioThermalStatusPayload
    public var storage: AlisioStorageStatusPayload
    public var network: AlisioNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: AlisioBatteryStatusPayload,
        thermal: AlisioThermalStatusPayload,
        storage: AlisioStorageStatusPayload,
        network: AlisioNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct AlisioDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}

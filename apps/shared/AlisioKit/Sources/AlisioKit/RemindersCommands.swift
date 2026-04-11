import Foundation

public enum AlisioRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum AlisioReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct AlisioRemindersListParams: Codable, Sendable, Equatable {
    public var status: AlisioReminderStatusFilter?
    public var limit: Int?

    public init(status: AlisioReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct AlisioRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct AlisioReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
    }
}

public struct AlisioRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [AlisioReminderPayload]

    public init(reminders: [AlisioReminderPayload]) {
        self.reminders = reminders
    }
}

public struct AlisioRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: AlisioReminderPayload

    public init(reminder: AlisioReminderPayload) {
        self.reminder = reminder
    }
}

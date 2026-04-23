import Observation
import SwiftUI

import AlisioSupport
struct CronSettings: View {
    enum ListState: Equatable {
        case loading
        case error(String)
        case empty(String)
        case list
    }

    enum DisplayMode: String, CaseIterable, Identifiable {
        case list
        case week
        case month

        var id: String { self.rawValue }

        var label: String {
            switch self {
            case .list: "List"
            case .week: "Week"
            case .month: "Month"
            }
        }
    }

    @Bindable var store: CronJobsStore
    @Bindable var channelsStore: ChannelsStore
    @State var displayMode: DisplayMode = .list
    @State var calendarReferenceDate = Date()
    @State var showEditor = false
    @State var editingJob: CronJob?
    @State var editorError: String?
    @State var isSaving = false
    @State var confirmDelete: CronJob?

    init(store: CronJobsStore = .shared, channelsStore: ChannelsStore = .shared) {
        self.store = store
        self.channelsStore = channelsStore
    }
}

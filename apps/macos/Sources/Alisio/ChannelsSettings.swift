import SwiftUI
import Observation

import AlisioSupport
struct ChannelsSettings: View {
    @Bindable var store: AppsSettingsStore
    @State var selectedAppID: String?

    init(store: AppsSettingsStore = .shared) {
        self.store = store
    }
}

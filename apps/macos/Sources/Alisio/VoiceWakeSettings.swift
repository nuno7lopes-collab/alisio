import AppKit
import AVFoundation
import Observation
import Speech
import SwabbleKit
import SwiftUI
import UniformTypeIdentifiers

import AlisioSupport
struct VoiceWakeSettings: View {
    @Bindable var state: AppState
    let isActive: Bool
    @State private var testState: VoiceWakeTestState = .idle
    @State private var tester = VoiceWakeTester()
    @State private var isTesting = false
    @State private var testTimeoutTask: Task<Void, Never>?
    @State private var availableMics: [AudioInputDevice] = []
    @State private var loadingMics = false
    @State private var didLoadMics = false
    @State private var meterLevel: Double = 0
    @State private var meterError: String?
    private let meter = MicLevelMonitor()
    @State private var micObserver = AudioInputDeviceObserver()
    @State private var micRefreshTask: Task<Void, Never>?
    @State private var availableLocales: [Locale] = []
    @State private var didLoadLocales = false
    @State private var triggerEntries: [TriggerEntry] = []
    private let fieldLabelWidth: CGFloat = 150
    private let controlWidth: CGFloat = 300
    private let isPreview = ProcessInfo.processInfo.isPreview

    private struct AudioInputDevice: Identifiable, Equatable {
        let uid: String
        let name: String
        var id: String {
            self.uid
        }
    }

    private struct TriggerEntry: Identifiable {
        let id: UUID
        var value: String
    }

    private var voiceWakeBinding: Binding<Bool> {
        MicRefreshSupport.voiceWakeBinding(for: self.state)
    }

    private var availableLocaleIDs: [String] {
        self.availableLocales.map(\.identifier)
    }

    private var resolvedLocaleSelection: VoiceWakeLocaleSelection {
        resolveVoiceWakeLocaleSelection(
            primary: self.state.voiceWakeLocaleID,
            additional: self.state.voiceWakeAdditionalLocaleIDs,
            availableLocaleIDs: self.availableLocaleIDs)
    }

    private var primaryLocaleBinding: Binding<String> {
        Binding(
            get: { self.resolvedLocaleSelection.primary },
            set: { newValue in
                self.applyLocaleSelection(primary: newValue, additional: self.state.voiceWakeAdditionalLocaleIDs)
            })
    }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 14) {
                SettingsToggleRow(
                    title: "Enable Voice Wake",
                    subtitle: "Listen for a wake phrase (e.g. \"Claude\") before running voice commands. "
                        + "Voice recognition runs fully on-device.",
                    binding: self.voiceWakeBinding)
                    .disabled(!voiceWakeSupported)

                SettingsToggleRow(
                    title: "Hold Right Option to talk",
                    subtitle: """
                    Push-to-talk mode that starts listening while you hold the key
                    and shows the preview overlay.
                    """,
                    binding: self.$state.voicePushToTalkEnabled)
                    .disabled(!voiceWakeSupported)

                if !voiceWakeSupported {
                    Label("Voice Wake requires macOS 26 or newer.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.yellow)
                        .padding(8)
                        .background(Color.secondary.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                self.localePicker
                self.micPicker
                self.levelMeter

                VoiceWakeTestCard(
                    testState: self.$testState,
                    isTesting: self.$isTesting,
                    onToggle: self.toggleTest)

                self.chimeSection

                self.triggerTable

                Spacer(minLength: 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
        }
        .task {
            guard !self.isPreview else { return }
            await self.loadMicsIfNeeded()
        }
        .task {
            guard !self.isPreview else { return }
            await self.loadLocalesIfNeeded()
        }
        .task {
            guard !self.isPreview else { return }
            await self.restartMeter()
        }
        .onAppear {
            guard !self.isPreview else { return }
            self.startMicObserver()
            self.loadTriggerEntries()
        }
        .onChange(of: self.state.voiceWakeMicID) { _, _ in
            guard !self.isPreview else { return }
            self.updateSelectedMicName()
            Task { await self.restartMeter() }
        }
        .onChange(of: self.isActive) { _, active in
            guard !self.isPreview else { return }
            if !active {
                self.tester.stop()
                self.isTesting = false
                self.testState = .idle
                self.testTimeoutTask?.cancel()
                self.micRefreshTask?.cancel()
                self.micRefreshTask = nil
                Task { await self.meter.stop() }
                self.micObserver.stop()
                self.syncTriggerEntriesToState()
            } else {
                self.startMicObserver()
                self.loadTriggerEntries()
            }
        }
        .onDisappear {
            guard !self.isPreview else { return }
            self.tester.stop()
            self.isTesting = false
            self.testState = .idle
            self.testTimeoutTask?.cancel()
            self.micRefreshTask?.cancel()
            self.micRefreshTask = nil
            self.micObserver.stop()
            Task { await self.meter.stop() }
            self.syncTriggerEntriesToState()
        }
    }

    private func loadTriggerEntries() {
        self.triggerEntries = self.state.swabbleTriggerWords.map { TriggerEntry(id: UUID(), value: $0) }
    }

    private func syncTriggerEntriesToState() {
        self.state.swabbleTriggerWords = self.triggerEntries.map(\.value)
    }

    private var triggerTable: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Trigger words")
                    .font(.callout.weight(.semibold))
                Spacer()
                Button {
                    self.addWord()
                } label: {
                    Label("Add word", systemImage: "plus")
                }
                .disabled(self.triggerEntries
                    .contains(where: { $0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))

                Button("Reset defaults") {
                    self.triggerEntries = defaultVoiceWakeTriggers.map { TriggerEntry(id: UUID(), value: $0) }
                    self.syncTriggerEntriesToState()
                }
            }

            VStack(spacing: 0) {
                ForEach(self.$triggerEntries) { $entry in
                    HStack(spacing: 8) {
                        TextField("Wake word", text: $entry.value)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit {
                                self.syncTriggerEntriesToState()
                            }

                        Button {
                            self.removeWord(id: entry.id)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .help("Remove trigger word")
                        .frame(width: 24)
                    }
                    .padding(8)

                    if entry.id != self.triggerEntries.last?.id {
                        Divider()
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
            .background(Color(nsColor: .textBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 1))

            Text(
                "Alisio reacts when any trigger appears in a transcription. "
                    + "Keep them short to avoid false positives.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var chimeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Sounds")
                    .font(.callout.weight(.semibold))
                Spacer()
            }

            self.chimeRow(
                title: "Trigger sound",
                selection: self.$state.voiceWakeTriggerChime)

            self.chimeRow(
                title: "Send sound",
                selection: self.$state.voiceWakeSendChime)
        }
        .padding(.top, 4)
    }

    private func addWord() {
        self.triggerEntries.append(TriggerEntry(id: UUID(), value: ""))
    }

    private func removeWord(id: UUID) {
        self.triggerEntries.removeAll { $0.id == id }
        self.syncTriggerEntriesToState()
    }

    private func toggleTest() {
        guard voiceWakeSupported else {
            self.testState = .failed("Voice Wake requires macOS 26 or newer.")
            return
        }
        if self.isTesting {
            self.tester.finalize()
            self.isTesting = false
            self.testState = .finalizing
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if self.testState == .finalizing {
                    self.tester.stop()
                    self.testState = .failed("Stopped")
                }
            }
            self.testTimeoutTask?.cancel()
            return
        }

        let triggers = self.sanitizedTriggers()
        self.tester.stop()
        self.testTimeoutTask?.cancel()
        self.isTesting = true
        self.testState = .requesting
        Task { @MainActor in
            do {
                try await self.tester.start(
                    triggers: triggers,
                    micID: self.state.voiceWakeMicID.isEmpty ? nil : self.state.voiceWakeMicID,
                    primaryLocaleID: self.resolvedLocaleSelection.primary,
                    additionalLocaleIDs: self.resolvedLocaleSelection.additional,
                    onUpdate: { newState in
                        DispatchQueue.main.async { [self] in
                            self.testState = newState
                            if case .detected = newState { self.isTesting = false }
                            if case .failed = newState { self.isTesting = false }
                            if case .detected = newState { self.testTimeoutTask?.cancel() }
                            if case .failed = newState { self.testTimeoutTask?.cancel() }
                        }
                    })
                self.testTimeoutTask?.cancel()
                self.testTimeoutTask = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 10 * 1_000_000_000)
                    guard !Task.isCancelled else { return }
                    if self.isTesting {
                        self.tester.stop()
                        if case let .hearing(text) = self.testState,
                           let command = Self.textOnlyCommand(from: text, triggers: triggers)
                        {
                            self.testState = .detected(command)
                        } else {
                            self.testState = .failed("Timeout: no trigger heard")
                        }
                        self.isTesting = false
                    }
                }
            } catch {
                self.tester.stop()
                self.testState = .failed(error.localizedDescription)
                self.isTesting = false
                self.testTimeoutTask?.cancel()
            }
        }
    }

    private func chimeRow(title: String, selection: Binding<VoiceWakeChime>) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Text(title)
                .font(.callout.weight(.semibold))
                .frame(width: self.fieldLabelWidth, alignment: .leading)

            Menu {
                Button("No Sound") { self.selectChime(.none, binding: selection) }
                Divider()
                ForEach(VoiceWakeChimeCatalog.systemOptions, id: \.self) { option in
                    Button(VoiceWakeChimeCatalog.displayName(for: option)) {
                        self.selectChime(.system(name: option), binding: selection)
                    }
                }
                Divider()
                Button("Choose file…") { self.chooseCustomChime(for: selection) }
            } label: {
                HStack(spacing: 6) {
                    Text(selection.wrappedValue.displayLabel)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(6)
                .frame(minWidth: self.controlWidth, maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .windowBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.secondary.opacity(0.25), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Button("Play") {
                VoiceWakeChimePlayer.play(selection.wrappedValue)
            }
            .keyboardShortcut(.space, modifiers: [.command])
        }
    }

    private func chooseCustomChime(for selection: Binding<VoiceWakeChime>) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.resolvesAliases = true
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let bookmark = try url.bookmarkData(
                    options: [.withSecurityScope],
                    includingResourceValuesForKeys: nil,
                    relativeTo: nil)
                let chosen = VoiceWakeChime.custom(displayName: url.lastPathComponent, bookmark: bookmark)
                selection.wrappedValue = chosen
                VoiceWakeChimePlayer.play(chosen)
            } catch {
                // Ignore failures; user can retry.
            }
        }
    }

    private func selectChime(_ chime: VoiceWakeChime, binding: Binding<VoiceWakeChime>) {
        binding.wrappedValue = chime
        VoiceWakeChimePlayer.play(chime)
    }

    private func sanitizedTriggers() -> [String] {
        sanitizeVoiceWakeTriggers(self.state.swabbleTriggerWords)
    }

    private static func textOnlyCommand(from transcript: String, triggers: [String]) -> String? {
        VoiceWakeTextUtils.textOnlyCommand(
            transcript: transcript,
            triggers: triggers,
            minCommandLength: 1,
            trimWake: { WakeWordGate.stripWake(text: $0, triggers: $1) })
    }

    private var micPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Microphone")
                    .font(.callout.weight(.semibold))
                    .frame(width: self.fieldLabelWidth, alignment: .leading)
                Picker("Microphone", selection: self.$state.voiceWakeMicID) {
                    Text("System default").tag("")
                    if self.isSelectedMicUnavailable {
                        Text(self.state.voiceWakeMicName.isEmpty ? "Unavailable" : self.state.voiceWakeMicName)
                            .tag(self.state.voiceWakeMicID)
                    }
                    ForEach(self.availableMics) { mic in
                        Text(mic.name).tag(mic.uid)
                    }
                }
                .labelsHidden()
                .frame(width: self.controlWidth)
            }
            if self.isSelectedMicUnavailable {
                HStack(spacing: 10) {
                    Color.clear.frame(width: self.fieldLabelWidth, height: 1)
                    Text("Disconnected (using System default)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if self.loadingMics {
                ProgressView().controlSize(.small)
            } else if self.didLoadMics, self.availableMics.isEmpty {
                HStack(spacing: 10) {
                    Color.clear.frame(width: self.fieldLabelWidth, height: 1)
                    Text("No microphone inputs detected yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private var localePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Text("Recognition language")
                    .font(.callout.weight(.semibold))
                    .frame(width: self.fieldLabelWidth, alignment: .leading)

                if self.availableLocaleIDs.isEmpty {
                    if self.didLoadLocales {
                        Text("No recognition languages available on this Mac.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(width: self.controlWidth, alignment: .leading)
                    } else {
                        ProgressView()
                            .controlSize(.small)
                            .frame(width: self.controlWidth, alignment: .leading)
                    }
                } else {
                    Picker("Language", selection: self.primaryLocaleBinding) {
                        ForEach(self.availableLocaleIDs, id: \.self) { id in
                            Text(self.primaryLocaleLabel(for: id)).tag(id)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .frame(width: self.controlWidth, alignment: .leading)
                }
            }

            let additional = self.resolvedLocaleSelection.additional
            if !additional.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Additional languages")
                        .font(.footnote.weight(.semibold))
                    ForEach(
                        Array(additional.enumerated()),
                        id: \.offset)
                    { idx, localeID in
                        HStack(spacing: 10) {
                            Text("\(idx + 2)")
                                .font(.caption.monospacedDigit().weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 18, alignment: .trailing)

                            Picker("Extra \(idx + 1)", selection: Binding(
                                get: { localeID },
                                set: { newValue in self.updateAdditionalLocale(at: idx, to: newValue) }
                            )) {
                                ForEach(self.additionalLocaleChoices(for: localeID), id: \.self) { id in
                                    Text(self.localeLabel(for: id)).tag(id)
                                }
                            }
                            .pickerStyle(.menu)
                            .labelsHidden()
                            .frame(width: self.controlWidth, alignment: .leading)

                            Button {
                                self.removeAdditionalLocale(at: idx)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .help("Remove language")
                        }
                    }

                    Button {
                        self.addAdditionalLocale()
                    } label: {
                        Label("Add language", systemImage: "plus")
                    }
                    .disabled(self.nextAdditionalLocaleID() == nil)
                }
                .padding(.leading, self.fieldLabelWidth + 10)
            } else {
                HStack(spacing: 10) {
                    Color.clear.frame(width: self.fieldLabelWidth, height: 1)
                    Button {
                        self.addAdditionalLocale()
                    } label: {
                        Label("Add language", systemImage: "plus")
                    }
                    .buttonStyle(.link)
                    .disabled(self.nextAdditionalLocaleID() == nil)
                }
            }

            Text(
                "Wake-word recognition tries languages in order. macOS may download a speech model the first time you use one.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func applyLocaleSelection(primary: String, additional: [String]) {
        let selection = resolveVoiceWakeLocaleSelection(
            primary: primary,
            additional: additional,
            availableLocaleIDs: self.availableLocaleIDs)
        guard selection.primary != self.state.voiceWakeLocaleID ||
            selection.additional != self.state.voiceWakeAdditionalLocaleIDs
        else { return }
        self.state.voiceWakeLocaleID = selection.primary
        self.state.voiceWakeAdditionalLocaleIDs = selection.additional
    }

    private func addAdditionalLocale() {
        guard let next = self.nextAdditionalLocaleID() else { return }
        var additional = self.resolvedLocaleSelection.additional
        additional.append(next)
        self.applyLocaleSelection(primary: self.resolvedLocaleSelection.primary, additional: additional)
    }

    private func updateAdditionalLocale(at index: Int, to newValue: String) {
        var additional = self.resolvedLocaleSelection.additional
        guard additional.indices.contains(index) else { return }
        additional[index] = newValue
        self.applyLocaleSelection(primary: self.resolvedLocaleSelection.primary, additional: additional)
    }

    private func removeAdditionalLocale(at index: Int) {
        var additional = self.resolvedLocaleSelection.additional
        guard additional.indices.contains(index) else { return }
        additional.remove(at: index)
        self.applyLocaleSelection(primary: self.resolvedLocaleSelection.primary, additional: additional)
    }

    private func nextAdditionalLocaleID() -> String? {
        let used = Set(self.resolvedLocaleSelection.ordered.compactMap(canonicalVoiceWakeLocaleIdentifier))
        return self.availableLocaleIDs.first { candidate in
            guard let canonical = canonicalVoiceWakeLocaleIdentifier(candidate) else { return false }
            return !used.contains(canonical)
        }
    }

    private func additionalLocaleChoices(for current: String) -> [String] {
        let currentCanonical = canonicalVoiceWakeLocaleIdentifier(current)
        let used = Set(
            self.resolvedLocaleSelection.ordered
                .compactMap(canonicalVoiceWakeLocaleIdentifier)
                .filter { $0 != currentCanonical })

        return self.availableLocaleIDs.filter { candidate in
            guard let canonical = canonicalVoiceWakeLocaleIdentifier(candidate) else { return false }
            return canonical == currentCanonical || !used.contains(canonical)
        }
    }

    private func localeLabel(for localeID: String) -> String {
        voiceWakeLocaleDisplayName(localeID)
    }

    private func primaryLocaleLabel(for localeID: String) -> String {
        guard let systemCanonical = canonicalVoiceWakeLocaleIdentifier(Locale.current.identifier),
              let localeCanonical = canonicalVoiceWakeLocaleIdentifier(localeID),
              systemCanonical == localeCanonical
        else {
            return self.localeLabel(for: localeID)
        }
        return "\(self.localeLabel(for: localeID)) (System)"
    }

    @MainActor
    private func loadMicsIfNeeded(force: Bool = false) async {
        guard force || self.availableMics.isEmpty, !self.loadingMics else { return }
        self.loadingMics = true
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external, .microphone],
            mediaType: .audio,
            position: .unspecified)
        let aliveUIDs = AudioInputDeviceObserver.aliveInputDeviceUIDs()
        let connectedDevices = discovery.devices.filter(\.isConnected)
        let devices = aliveUIDs.isEmpty
            ? connectedDevices
            : connectedDevices.filter { aliveUIDs.contains($0.uniqueID) }
        self.availableMics = devices.map { AudioInputDevice(uid: $0.uniqueID, name: $0.localizedName) }
        self.updateSelectedMicName()
        self.didLoadMics = true
        self.loadingMics = false
    }

    private var isSelectedMicUnavailable: Bool {
        let selected = self.state.voiceWakeMicID
        guard !selected.isEmpty else { return false }
        return !self.availableMics.contains(where: { $0.uid == selected })
    }

    @MainActor
    private func updateSelectedMicName() {
        self.state.voiceWakeMicName = MicRefreshSupport.selectedMicName(
            selectedID: self.state.voiceWakeMicID,
            in: self.availableMics,
            uid: \.uid,
            name: \.name)
    }

    private func startMicObserver() {
        MicRefreshSupport.startObserver(self.micObserver) {
            self.scheduleMicRefresh()
        }
    }

    @MainActor
    private func scheduleMicRefresh() {
        MicRefreshSupport.schedule(refreshTask: &self.micRefreshTask) {
            await self.loadMicsIfNeeded(force: true)
            await self.restartMeter()
        }
    }

    @MainActor
    private func loadLocalesIfNeeded() async {
        guard self.availableLocales.isEmpty else { return }
        self.availableLocales = Array(SFSpeechRecognizer.supportedLocales()).sorted { lhs, rhs in
            voiceWakeLocaleDisplayName(lhs.identifier)
                .localizedCaseInsensitiveCompare(voiceWakeLocaleDisplayName(rhs.identifier)) == .orderedAscending
        }
        self.didLoadLocales = true
        self.applyLocaleSelection(
            primary: self.state.voiceWakeLocaleID,
            additional: self.state.voiceWakeAdditionalLocaleIDs)
    }

    private var levelMeter: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 10) {
                Text("Live level")
                    .font(.callout.weight(.semibold))
                    .frame(width: self.fieldLabelWidth, alignment: .leading)
                MicLevelBar(level: self.meterLevel)
                    .frame(width: self.controlWidth, alignment: .leading)
                Text(self.levelLabel)
                    .font(.callout.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: 60, alignment: .trailing)
            }
            if let meterError {
                Text(meterError)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var levelLabel: String {
        let db = (meterLevel * 50) - 50
        return String(format: "%.0f dB", db)
    }

    @MainActor
    private func restartMeter() async {
        self.meterError = nil
        await self.meter.stop()
        do {
            try await self.meter.start { [weak state] level in
                Task { @MainActor in
                    guard state != nil else { return }
                    self.meterLevel = level
                }
            }
        } catch {
            self.meterError = error.localizedDescription
        }
    }
}

#if DEBUG
struct VoiceWakeSettings_Previews: PreviewProvider {
    static var previews: some View {
        VoiceWakeSettings(state: .preview, isActive: true)
            .frame(width: SettingsTab.windowWidth, height: SettingsTab.windowHeight)
    }
}

#endif

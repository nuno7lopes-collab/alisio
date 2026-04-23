import Observation
import SwiftUI

import AlisioSupport
struct CronJobEditor: View {
    let job: CronJob?
    @Binding var isSaving: Bool
    @Binding var error: String?
    @Bindable var channelsStore: ChannelsStore
    let onCancel: () -> Void
    let onSave: ([String: AnyCodable]) -> Void

    let labelColumnWidth: CGFloat = 160
    static let introText =
        "Choose when Alisio should take this action. "
            + "Use a separate chat if you do not want the work mixed into the main chat."
    static let sessionTargetNote =
        "The main chat posts directly into the main conversation. "
            + "This chat and separate chats can run agent work and send follow-ups elsewhere."
    static let scheduleKindNote =
        "One time runs at a specific moment. Repeating runs on an interval. Custom uses a time pattern."
    static let isolatedPayloadNote =
        "Separate chats always run agent work."
    static let mainPayloadNote =
        "The main chat posts a note here. Switch to a separate chat to run agent work."

    @State var name: String = ""
    @State var description: String = ""
    @State var agentId: String = ""
    @State var enabled: Bool = true
    @State var sessionTarget: CronSessionTarget = .main
    @State var preservedSessionTargetRaw: String?
    @State var wakeMode: CronWakeMode = .now
    @State var deleteAfterRun: Bool = false

    enum ScheduleKind: String, CaseIterable, Identifiable { case at, every, cron; var id: String {
        rawValue
    } }
    @State var scheduleKind: ScheduleKind = .every
    @State var atDate: Date = .init().addingTimeInterval(60 * 5)
    @State var everyText: String = "1h"
    @State var cronExpr: String = "0 9 * * 3"
    @State var cronTz: String = ""
    @State var cronStaggerMs: Int?

    enum PayloadKind: String, CaseIterable, Identifiable { case systemEvent, agentTurn; var id: String {
        rawValue
    } }
    @State var payloadKind: PayloadKind = .systemEvent
    @State var systemEventText: String = ""
    @State var agentMessage: String = ""
    enum DeliveryChoice: String, CaseIterable, Identifiable { case announce, webhook, none; var id: String {
        rawValue
    } }
    @State var deliveryMode: DeliveryChoice = .none
    @State var channel: String = "last"
    @State var to: String = ""
    @State var thinking: String = ""
    @State var timeoutSeconds: String = ""
    @State var bestEffortDeliver: Bool = false

    var channelOptions: [String] {
        let ordered = self.channelsStore.orderedChannelIds()
        var options = ["last"] + ordered
        let trimmed = self.channel.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, !options.contains(trimmed) {
            options.append(trimmed)
        }
        var seen = Set<String>()
        return options.filter { seen.insert($0).inserted }
    }

    func channelLabel(for id: String) -> String {
        if id == "last" { return "last used" }
        return self.channelsStore.resolveChannelLabel(id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(self.job == nil ? "New schedule" : "Edit schedule")
                    .font(.title3.weight(.semibold))
                Text(Self.introText)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 14) {
                    GroupBox("General") {
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                            GridRow {
                                self.gridLabel("Name")
                                TextField("Required (for example, “Daily summary”)", text: self.$name)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(maxWidth: .infinity)
                            }
                            GridRow {
                                self.gridLabel("Description")
                                TextField("Optional notes", text: self.$description)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(maxWidth: .infinity)
                            }
                            GridRow {
                                self.gridLabel("Agent")
                                TextField("Optional (uses the default agent)", text: self.$agentId)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(maxWidth: .infinity)
                            }
                            GridRow {
                                self.gridLabel("Active")
                                Toggle("", isOn: self.$enabled)
                                    .labelsHidden()
                                    .toggleStyle(.switch)
                            }
                            GridRow {
                                self.gridLabel("Conversation")
                                Picker("", selection: self.$sessionTarget) {
                                    Text("main chat").tag(CronSessionTarget.main)
                                    Text("separate chat").tag(CronSessionTarget.isolated)
                                    Text("this chat").tag(CronSessionTarget.current)
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            GridRow {
                                self.gridLabel("Start")
                                Picker("", selection: self.$wakeMode) {
                                    Text("immediately").tag(CronWakeMode.now)
                                    Text("on wake-up").tag(CronWakeMode.nextHeartbeat)
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            GridRow {
                                Color.clear
                                    .frame(width: self.labelColumnWidth, height: 1)
                                Text(
                                    Self.sessionTargetNote)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }

                    GroupBox("Timing") {
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                            GridRow {
                                self.gridLabel("Type")
                                Picker("", selection: self.$scheduleKind) {
                                    Text("one time").tag(ScheduleKind.at)
                                    Text("repeating").tag(ScheduleKind.every)
                                    Text("custom").tag(ScheduleKind.cron)
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                                .frame(maxWidth: .infinity)
                            }
                            GridRow {
                                Color.clear
                                    .frame(width: self.labelColumnWidth, height: 1)
                                Text(
                                    Self.scheduleKindNote)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            switch self.scheduleKind {
                            case .at:
                                GridRow {
                                    self.gridLabel("When")
                                    DatePicker(
                                        "",
                                        selection: self.$atDate,
                                        displayedComponents: [.date, .hourAndMinute])
                                        .labelsHidden()
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                GridRow {
                                    self.gridLabel("Remove after success")
                                    Toggle("Remove this schedule after it succeeds", isOn: self.$deleteAfterRun)
                                        .toggleStyle(.switch)
                                }
                            case .every:
                                GridRow {
                                    self.gridLabel("Repeat every")
                                    TextField("10m, 1h, 1d", text: self.$everyText)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                            case .cron:
                                GridRow {
                                    self.gridLabel("Pattern")
                                    TextField("e.g. 0 9 * * 3", text: self.$cronExpr)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                                GridRow {
                                    self.gridLabel("Time zone")
                                    TextField("Optional (for example, Europe/Lisbon)", text: self.$cronTz)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }

                    GroupBox("What Happens") {
                        VStack(alignment: .leading, spacing: 10) {
                            if self.isIsolatedLikeSessionTarget {
                                Text(Self.isolatedPayloadNote)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                self.agentTurnEditor
                            } else {
                                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                                    GridRow {
                                        self.gridLabel("Type")
                                        Picker("", selection: self.$payloadKind) {
                                            Text("post note").tag(PayloadKind.systemEvent)
                                            Text("run task").tag(PayloadKind.agentTurn)
                                        }
                                        .labelsHidden()
                                        .pickerStyle(.segmented)
                                        .frame(maxWidth: .infinity)
                                    }
                                    GridRow {
                                        Color.clear
                                            .frame(width: self.labelColumnWidth, height: 1)
                                        Text(
                                            Self.mainPayloadNote)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                }

                                switch self.payloadKind {
                                case .systemEvent:
                                    TextField("What should appear in the main chat?", text: self.$systemEventText, axis: .vertical)
                                        .textFieldStyle(.roundedBorder)
                                        .lineLimit(3...7)
                                        .frame(maxWidth: .infinity)
                                case .agentTurn:
                                    self.agentTurnEditor
                                }
                            }
                        }
                    }

                    GroupBox("After It Runs") {
                        self.followUpEditor
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 2)
            }

            if let error, !error.isEmpty {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Button("Cancel") { self.onCancel() }
                    .keyboardShortcut(.cancelAction)
                    .buttonStyle(.bordered)
                Spacer()
                Button {
                    self.save()
                } label: {
                    if self.isSaving {
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Save")
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(self.isSaving)
            }
        }
        .padding(24)
        .frame(minWidth: 720, minHeight: 640)
        .onAppear { self.hydrateFromJob() }
        .onChange(of: self.payloadKind) { _, newValue in
            if newValue == .agentTurn, self.sessionTarget == .main {
                self.sessionTarget = .isolated
            }
        }
        .onChange(of: self.sessionTarget) { oldValue, newValue in
            if oldValue != newValue {
                self.preservedSessionTargetRaw = nil
            }
            if newValue != .main {
                self.payloadKind = .agentTurn
                if oldValue == .main, self.job?.delivery == nil, self.deliveryMode == .none {
                    self.deliveryMode = .announce
                }
            } else if newValue == .main, self.payloadKind == .agentTurn {
                self.payloadKind = .systemEvent
            }
            if newValue == .main, self.deliveryMode == .announce {
                self.deliveryMode = .none
            }
        }
    }

    var agentTurnEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    self.gridLabel("Instruction")
                    TextField("What should Alisio do?", text: self.$agentMessage, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(3...7)
                        .frame(maxWidth: .infinity)
                }
                GridRow {
                    self.gridLabel("Thinking")
                    TextField("Optional (for example, low)", text: self.$thinking)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: .infinity)
                }
                GridRow {
                    self.gridLabel("Timeout")
                    TextField("Seconds (optional)", text: self.$timeoutSeconds)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 180, alignment: .leading)
                }
            }
        }
    }

    var followUpEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    self.gridLabel("Send")
                    Picker("", selection: self.$deliveryMode) {
                        if self.canAnnounceFollowUp {
                            Text("post to chat").tag(DeliveryChoice.announce)
                        }
                        Text("send to URL").tag(DeliveryChoice.webhook)
                        Text("nothing else").tag(DeliveryChoice.none)
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }
            }

            if self.deliveryMode == .announce {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    GridRow {
                        self.gridLabel("Chat")
                        Picker("", selection: self.$channel) {
                            ForEach(self.channelOptions, id: \.self) { channel in
                                Text(self.channelLabel(for: channel)).tag(channel)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    GridRow {
                        self.gridLabel("To")
                        TextField("Optional (phone, chat ID, or channel)", text: self.$to)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    GridRow {
                        self.gridLabel("Best effort")
                        Toggle("Do not fail the schedule if the follow-up cannot be sent", isOn: self.$bestEffortDeliver)
                            .toggleStyle(.switch)
                    }
                }
            } else if self.deliveryMode == .webhook {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    GridRow {
                        self.gridLabel("URL")
                        TextField("https://example.com/hook", text: self.$to)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    GridRow {
                        self.gridLabel("Best effort")
                        Toggle("Do not fail the schedule if the follow-up cannot be sent", isOn: self.$bestEffortDeliver)
                            .toggleStyle(.switch)
                    }
                }
            }
        }
    }
}

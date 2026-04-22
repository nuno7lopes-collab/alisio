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
        "Choose when Alisio should run this task. "
            + "Use an isolated session if you do not want the result mixed into the main chat."
    static let sessionTargetNote =
        "The main session posts into the main chat. "
            + "Current and isolated sessions run agent work and can announce the result to a channel."
    static let scheduleKindNote =
        "Once runs at a specific time. Every repeats on an interval. Cron uses an advanced 5-field expression."
    static let isolatedPayloadNote =
        "Isolated sessions always run an agent task. You can announce a summary to a channel."
    static let mainPayloadNote =
        "The main session receives a chat note. To run an agent task, switch the session target to isolated."

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

    enum PayloadKind: String, CaseIterable, Identifiable { case systemEvent, agentTurn; var id: String {
        rawValue
    } }
    @State var payloadKind: PayloadKind = .systemEvent
    @State var systemEventText: String = ""
    @State var agentMessage: String = ""
    enum DeliveryChoice: String, CaseIterable, Identifiable { case announce, none; var id: String {
        rawValue
    } }
    @State var deliveryMode: DeliveryChoice = .announce
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
        if id == "last" { return "último usado" }
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
                    GroupBox("Basics") {
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
                                self.gridLabel("Agent ID")
                                TextField("Optional (uses the default agent)", text: self.$agentId)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(maxWidth: .infinity)
                            }
                            GridRow {
                                self.gridLabel("Enabled")
                                Toggle("", isOn: self.$enabled)
                                    .labelsHidden()
                                    .toggleStyle(.switch)
                            }
                            GridRow {
                                self.gridLabel("Session")
                                Picker("", selection: self.$sessionTarget) {
                                    Text("main").tag(CronSessionTarget.main)
                                    Text("isolated").tag(CronSessionTarget.isolated)
                                    Text("current").tag(CronSessionTarget.current)
                                }
                                .labelsHidden()
                                .pickerStyle(.segmented)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            GridRow {
                                self.gridLabel("Wake mode")
                                Picker("", selection: self.$wakeMode) {
                                    Text("now").tag(CronWakeMode.now)
                                    Text("next heartbeat").tag(CronWakeMode.nextHeartbeat)
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

                    GroupBox("Schedule") {
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                            GridRow {
                                self.gridLabel("Type")
                                Picker("", selection: self.$scheduleKind) {
                                    Text("once").tag(ScheduleKind.at)
                                    Text("every").tag(ScheduleKind.every)
                                    Text("cron").tag(ScheduleKind.cron)
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
                                    self.gridLabel("At")
                                    DatePicker(
                                        "",
                                        selection: self.$atDate,
                                        displayedComponents: [.date, .hourAndMinute])
                                        .labelsHidden()
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                GridRow {
                                    self.gridLabel("Delete after run")
                                    Toggle("Delete after a successful run", isOn: self.$deleteAfterRun)
                                        .toggleStyle(.switch)
                                }
                            case .every:
                                GridRow {
                                    self.gridLabel("Every")
                                    TextField("10m, 1h, 1d", text: self.$everyText)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                            case .cron:
                                GridRow {
                                    self.gridLabel("Expression")
                                    TextField("e.g. 0 9 * * 3", text: self.$cronExpr)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                                GridRow {
                                    self.gridLabel("Timezone")
                                    TextField("Optional (for example, Europe/Lisbon)", text: self.$cronTz)
                                        .textFieldStyle(.roundedBorder)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }

                    GroupBox("Action") {
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
                                            Text("chat note").tag(PayloadKind.systemEvent)
                                            Text("agent task").tag(PayloadKind.agentTurn)
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
            } else if newValue == .main, self.payloadKind == .agentTurn {
                self.payloadKind = .systemEvent
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
                GridRow {
                    self.gridLabel("Delivery")
                    Picker("", selection: self.$deliveryMode) {
                        Text("announce summary").tag(DeliveryChoice.announce)
                        Text("none").tag(DeliveryChoice.none)
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                }
            }

            if self.deliveryMode == .announce {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    GridRow {
                        self.gridLabel("Channel")
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
                        self.gridLabel("Destination")
                        TextField("Optional (phone / chat ID / Discord channel)", text: self.$to)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    GridRow {
                        self.gridLabel("Best effort")
                        Toggle("Do not fail the schedule if delivery fails", isOn: self.$bestEffortDeliver)
                            .toggleStyle(.switch)
                    }
                }
            }
        }
    }
}

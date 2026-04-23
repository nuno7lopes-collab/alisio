import SwiftUI

import AlisioSupport
extension CronSettings {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.header
            self.automaticRunsBanner
            self.content
            Spacer(minLength: 0)
        }
        .onAppear {
            self.store.start()
            self.channelsStore.start()
            self.store.reconcileSelection()
        }
        .onDisappear {
            self.store.stop()
            self.channelsStore.stop()
        }
        .sheet(isPresented: self.$showEditor) {
            CronJobEditor(
                job: self.editingJob,
                isSaving: self.$isSaving,
                error: self.$editorError,
                channelsStore: self.channelsStore,
                onCancel: {
                    self.showEditor = false
                    self.editingJob = nil
                },
                onSave: { request in
                    Task {
                        await self.save(request: request)
                    }
                })
        }
        .alert("Delete schedule?", isPresented: Binding(
            get: { self.confirmDelete != nil },
            set: { if !$0 { self.confirmDelete = nil } }))
        {
            Button("Cancel", role: .cancel) { self.confirmDelete = nil }
            Button("Delete", role: .destructive) {
                if let job = self.confirmDelete {
                    Task { await self.store.removeJob(id: job.id) }
                }
                self.confirmDelete = nil
            }
        } message: {
            if let job = self.confirmDelete {
                Text("This permanently removes \(job.displayName).")
            }
        }
        .onChange(of: self.store.jobs) { _, _ in
            self.store.reconcileSelection()
        }
        .onChange(of: self.store.selectedJobId) { _, newValue in
            guard let newValue else { return }
            Task { await self.store.refreshRuns(jobId: newValue) }
        }
    }

    var automaticRunsBanner: some View {
        Group {
            if self.store.automaticRunsEnabled == false {
                self.stateCard(
                    title: "Automatic runs are currently off.",
                    message: "Schedules stay saved, but they will not run until automatic runs are turned back on.",
                    systemImage: "pause.circle.fill",
                    tint: .orange)
            }
        }
    }

    var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Schedules")
                    .font(.headline)
                Text("Create, review, and run work at the right time.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            HStack(spacing: 10) {
                Picker("View", selection: self.$displayMode) {
                    ForEach(CronSettings.DisplayMode.allCases) { mode in
                        Text(mode.title)
                            .tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 220)

                Button {
                    Task { await self.store.refreshJobs() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(self.store.isLoadingJobs)

                Button {
                    self.editorError = nil
                    self.editingJob = nil
                    self.showEditor = true
                } label: {
                    Label("New schedule", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }

    @ViewBuilder
    var content: some View {
        switch self.displayMode {
        case .list:
            self.listContent
        case .week, .month:
            self.calendarContent
        }
    }

    var listContent: some View {
        HStack(spacing: 12) {
            self.listPane
                .frame(width: 300)
                .frame(maxHeight: .infinity, alignment: .topLeading)

            Divider()
            self.detail
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    var listPane: some View {
        switch self.listState {
        case .loading:
            self.stateCard(
                title: "Loading schedules…",
                message: "Checking what is set up on this Mac.",
                systemImage: "calendar.badge.clock",
                showsProgress: true)
        case let .error(message):
            self.stateCard(
                title: "Schedules could not be loaded.",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                tint: .orange,
                actionTitle: "Try again")
            {
                Task { await self.store.refreshJobs() }
            }
        case let .empty(message):
            if message.hasPrefix("Sign in") {
                self.stateCard(
                    title: message,
                    message: "After you sign in, this account's schedules appear here.",
                    systemImage: "person.crop.circle.badge.exclamationmark")
            } else {
                self.stateCard(
                    title: message,
                    message: "Create the first schedule to run work later.",
                    systemImage: "calendar.badge.plus",
                    actionTitle: "New schedule")
                {
                    self.editorError = nil
                    self.editingJob = nil
                    self.showEditor = true
                }
            }
        case .list:
            VStack(alignment: .leading, spacing: 8) {
                if self.store.isLoadingJobs {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Refreshing…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else if let error = self.trimmedJobsError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let actionError = self.trimmedActionError {
                    Text(actionError)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let message = self.trimmedStatusMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                List(selection: Binding(
                    get: { self.store.selectedJobId },
                    set: { self.store.selectJob($0) }))
                {
                    ForEach(self.store.jobs) { job in
                        self.jobRow(job)
                            .tag(job.id)
                            .contextMenu { self.jobContextMenu(job) }
                    }
                }
                .listStyle(.inset)
            }
        }
    }

    @ViewBuilder
    var detail: some View {
        if let selected = self.store.selectedJob {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 12) {
                    self.detailHeader(selected)
                    self.detailCard(selected)
                    self.runHistoryCard(selected)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
            }
        } else {
            switch self.listState {
            case .loading:
                self.stateCard(
                    title: "Preparing details…",
                    message: "Details appear as soon as the first schedule is available.",
                    systemImage: "calendar",
                    showsProgress: true)
            case .error:
                self.stateCard(
                    title: "No details to show.",
                    message: "When schedules load again, the selected schedule appears here.",
                    systemImage: "rectangle.on.rectangle.slash")
            case .empty:
                self.stateCard(
                    title: "Nothing to show yet.",
                    message: "When a schedule exists, its details appear here.",
                    systemImage: "calendar")
            case .list:
                self.stateCard(
                    title: "Choose a schedule.",
                    message: "Details and recent activity appear here.",
                    systemImage: "list.bullet.rectangle")
            }
        }
    }

    func stateCard(
        title: String,
        message: String,
        systemImage: String,
        tint: Color = .secondary,
        showsProgress: Bool = false,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil) -> some View
    {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                if showsProgress {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                        .foregroundStyle(tint)
                }

                Text(title)
                    .font(.headline)
            }

            Text(message)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .background(Color.secondary.opacity(0.06))
        .cornerRadius(8)
    }
}

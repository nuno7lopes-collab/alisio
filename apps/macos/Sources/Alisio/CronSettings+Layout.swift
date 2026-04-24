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
                WorkspaceInlineBanner(
                    text: "Automatic runs are off. Schedules stay saved, but nothing runs again until you turn automatic runs back on.",
                    tone: .caution)
            }
        }
    }

    var header: some View {
        WorkspaceRouteHeader(
            title: "Schedules",
            subtitle: "Plan work, review history, and make changes from one place.",
            showsTitle: self.showsHeader)
        {
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
        let calendar = Calendar.current
        let projection = self.detailProjection(using: calendar)
        switch self.displayMode {
        case .list:
            self.listContent(projection: projection, calendar: calendar)
        case .week, .month:
            self.calendarContent(projection: projection, calendar: calendar)
        }
    }

    func listContent(projection: ScheduleCalendarProjection, calendar: Calendar) -> some View {
        HStack(spacing: 12) {
            self.listPane(projection: projection)
                .frame(width: 320)
                .frame(maxHeight: .infinity, alignment: .topLeading)

            Divider()
            self.detail(projection: projection, calendar: calendar)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    func listPane(projection: ScheduleCalendarProjection) -> some View {
        switch self.listState {
        case .loading:
            WorkspaceStateCard(
                title: "Loading schedules…",
                message: "Checking what is set up on this Mac.",
                systemImage: "calendar.badge.clock",
                showsProgress: true)
        case let .error(message):
            WorkspaceStateCard(
                title: "Schedules could not be loaded.",
                message: message,
                systemImage: "exclamationmark.triangle.fill",
                tone: .caution,
                actionTitle: "Try again")
            {
                Task { await self.store.refreshJobs() }
            }
        case let .empty(message):
            if message.hasPrefix("Sign in") {
                WorkspaceStateCard(
                    title: message,
                    message: "After you sign in, this account's schedules appear here.",
                    systemImage: "person.crop.circle.badge.exclamationmark")
            } else {
                WorkspaceStateCard(
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
                        self.jobRow(job, coverage: projection.coverage(for: job.id))
                            .tag(job.id)
                            .contextMenu { self.jobContextMenu(job) }
                    }
                }
                .listStyle(.inset)
            }
        }
    }

    @ViewBuilder
    func detail(projection: ScheduleCalendarProjection, calendar: Calendar) -> some View {
        if let selected = self.store.selectedJob {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 12) {
                    self.detailHeader(
                        selected,
                        coverage: projection.coverage(for: selected.id),
                        projection: projection)
                    self.detailCard(
                        selected,
                        coverage: projection.coverage(for: selected.id),
                        projection: projection,
                        calendar: calendar)
                    self.runHistoryCard(selected)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
            }
        } else {
            switch self.listState {
            case .loading:
                WorkspaceStateCard(
                    title: "Preparing details…",
                    message: "Details appear as soon as the first schedule is available.",
                    systemImage: "calendar",
                    showsProgress: true)
            case .error:
                WorkspaceStateCard(
                    title: "No details to show.",
                    message: "When schedules load again, the selected schedule appears here.",
                    systemImage: "rectangle.on.rectangle.slash")
            case .empty:
                WorkspaceStateCard(
                    title: "Nothing to show yet.",
                    message: "When a schedule exists, its details appear here.",
                    systemImage: "calendar")
            case .list:
                WorkspaceStateCard(
                    title: "Choose a schedule.",
                    message: "Details and recent activity appear here.",
                    systemImage: "list.bullet.rectangle")
            }
        }
    }
}

import Foundation
import Testing

@testable import Alisio

@Suite(.serialized)
@MainActor
struct MemorySettingsModelTests {
    @Test func `starts in loading state before first refresh`() {
        let model = Self.makeModel()

        #expect(model.listState == .loading)
        #expect(model.sections.isEmpty)
    }

    @Test func `shows honest empty state when no present memory files exist`() async {
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "IDENTITY.md", kind: "identity", present: false),
                        Self.document(path: "MEMORY.md", kind: "main_memory", present: false),
                    ])),
            ])

        await model.refresh()

        #expect(model.listState == .empty("No memory files are available yet."))
        #expect(model.sections.isEmpty)
        #expect(model.selectedDocument == nil)
    }

    @Test func `groups canonical files into native sections`() async {
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "AGENTS.md", kind: "agent_instructions"),
                        Self.document(path: "IDENTITY.md", kind: "identity"),
                        Self.document(path: "SOUL.md", kind: "soul"),
                        Self.document(path: "MEMORY.md", kind: "main_memory"),
                        Self.document(path: "memory/topic-a.md", kind: "topic_note"),
                        Self.document(path: "memory/2026-04-23.md", kind: "daily_note"),
                        Self.document(path: "memory/backlog/2026-04-23/follow-up.md", kind: "backlog_note"),
                    ])),
            ],
            contents: [
                "AGENTS.md": "# Agent\n",
                "IDENTITY.md": "# Identity\n",
                "SOUL.md": "# Soul\n",
                "MEMORY.md": "# Main\n",
                "memory/topic-a.md": "# Topic\n",
                "memory/2026-04-23.md": "# Daily\n",
                "memory/backlog/2026-04-23/follow-up.md": "# Backlog\n",
            ])

        await model.refresh()

        #expect(model.sections.map(\.section) == [
            .mainMemory,
            .dailyNotes,
            .topicNotes,
            .backlogNotes,
            .identity,
            .soul,
            .agentFiles,
        ])
        #expect(model.sections.first(where: { $0.section == .mainMemory })?.items.map(\.path) == ["MEMORY.md"])
        #expect(model.sections.first(where: { $0.section == .dailyNotes })?.items.map(\.path) == ["memory/2026-04-23.md"])
        #expect(model.sections.first(where: { $0.section == .topicNotes })?.items.map(\.path) == ["memory/topic-a.md"])
        #expect(model.sections.first(where: { $0.section == .backlogNotes })?.items.map(\.path) == ["memory/backlog/2026-04-23/follow-up.md"])
        #expect(model.sections.first(where: { $0.section == .identity })?.items.map(\.path) == ["IDENTITY.md"])
        #expect(model.sections.first(where: { $0.section == .soul })?.items.map(\.path) == ["SOUL.md"])
        #expect(model.sections.first(where: { $0.section == .agentFiles })?.items.map(\.path) == ["AGENTS.md"])
        #expect(model.selectedDocument?.item.path == "MEMORY.md")
        #expect(model.selectedDocument?.content == "# Main\n")
    }

    @Test func `search reads canonical file content through gateway client`() async {
        let recorder = FileGetRecorder()
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "MEMORY.md", kind: "main_memory"),
                        Self.document(path: "memory/physics.md", kind: "topic_note"),
                    ])),
            ],
            contents: [
                "MEMORY.md": "# Memory\nShort notes.\n",
                "memory/physics.md": "# Physics\nBoson summary.\n",
            ],
            onRead: { path in
                await recorder.record(path)
            })

        await model.refresh()
        await model.search(query: "boson")

        #expect(model.listState == .list)
        #expect(model.sections.map(\.section) == [.topicNotes])
        #expect(model.sections.first?.items.map(\.path) == ["memory/physics.md"])
        #expect(await recorder.paths.contains("memory/physics.md"))
    }

    @Test func `exposes gateway failures honestly`() async {
        let model = MemorySettingsModel(
            client: MemorySettingsClient(
                listAgents: {
                    throw NSError(
                        domain: "Tests",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Gateway offline"])
                },
                readFile: { _, _ in
                    throw NSError(domain: "Tests", code: 2)
                }),
            accountGate: { _ in .authenticated })

        await model.refresh()

        #expect(model.listState == .error("Gateway offline"))
        #expect(model.sections.isEmpty)
    }

    private actor FileGetRecorder {
        private(set) var paths: [String] = []

        func record(_ path: String) {
            self.paths.append(path)
        }
    }

    private static func makeClient(
        agents: [MemoryAgentSummary] = [],
        contents: [String: String] = [:],
        onRead: (@Sendable (String) async -> Void)? = nil) -> MemorySettingsClient
    {
        MemorySettingsClient(
            listAgents: {
                MemoryAgentsListResult(agents: agents)
            },
            readFile: { _, path in
                await onRead?(path)
                return MemoryAgentFilePayload(
                    name: URL(fileURLWithPath: path).lastPathComponent,
                    path: path,
                    missing: false,
                    size: contents[path]?.utf8.count,
                    updatedAtMs: 1_713_830_400_000,
                    content: contents[path] ?? "")
            })
    }

    private static func makeModel(
        agents: [MemoryAgentSummary] = [],
        contents: [String: String] = [:],
        onRead: (@Sendable (String) async -> Void)? = nil) -> MemorySettingsModel
    {
        MemorySettingsModel(
            client: Self.makeClient(agents: agents, contents: contents, onRead: onRead),
            accountGate: { _ in .authenticated })
    }

    private static func document(
        path: String,
        kind: String,
        present: Bool = true,
        size: Int? = 128,
        updatedAtMs: Int? = 1_713_830_400_000) -> MemoryPersonalContextDocument
    {
        MemoryPersonalContextDocument(
            path: path,
            kind: kind,
            present: present,
            size: size,
            updatedAtMs: updatedAtMs)
    }
}

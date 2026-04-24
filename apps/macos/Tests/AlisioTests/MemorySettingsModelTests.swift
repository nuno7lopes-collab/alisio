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

        #expect(
            model.listState
                == .empty(
                    "No daily notes, topic notes, main memory, identity, soul, or agent files are available yet."))
        #expect(model.sections.isEmpty)
        #expect(model.selectedDocument == nil)
    }

    @Test func `groups supported canonical files into native sections`() async {
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "memory/backlog/2026-04-23/follow-up.md", kind: "backlog_note"),
                        Self.document(path: "memory/topic-z.md", kind: "topic_note"),
                        Self.document(path: "SOUL.md", kind: "soul"),
                        Self.document(path: "HEARTBEAT.md", kind: "agent_heartbeat"),
                        Self.document(path: "memory/2026-04-22.md", kind: "daily_note"),
                        Self.document(path: "TOOLS.md", kind: "agent_tools"),
                        Self.document(path: "memory/topic-a.md", kind: "topic_note"),
                        Self.document(path: "USER.md", kind: "preferences"),
                        Self.document(path: "IDENTITY.md", kind: "identity"),
                        Self.document(path: "AGENTS.md", kind: "agent_instructions"),
                        Self.document(path: "MEMORY.md", kind: "main_memory"),
                        Self.document(path: "BOOTSTRAP.md", kind: "setup_bootstrap"),
                        Self.document(path: "memory/2026-04-23.md", kind: "daily_note"),
                    ])),
            ],
            contents: [
                "AGENTS.md": "# Agent\n",
                "TOOLS.md": "# Tools\n",
                "HEARTBEAT.md": "# Heartbeat\n",
                "IDENTITY.md": "# Identity\n",
                "SOUL.md": "# Soul\n",
                "USER.md": "# User\n",
                "BOOTSTRAP.md": "# Bootstrap\n",
                "MEMORY.md": "# Main\n",
                "memory/topic-a.md": "# Topic\n",
                "memory/topic-z.md": "# Topic Z\n",
                "memory/2026-04-22.md": "# Daily Older\n",
                "memory/2026-04-23.md": "# Daily\n",
                "memory/backlog/2026-04-23/follow-up.md": "# Backlog\n",
            ])

        await model.refresh()

        #expect(model.sections.map(\.section) == [
            .mainMemory,
            .topicNotes,
            .dailyNotes,
            .identity,
            .soul,
            .agentFiles,
        ])
        #expect(model.sections.first(where: { $0.section == .mainMemory })?.items.map(\.path) == ["MEMORY.md"])
        #expect(model.sections.first(where: { $0.section == .dailyNotes })?.items.map(\.path) == [
            "memory/2026-04-23.md",
            "memory/2026-04-22.md",
        ])
        #expect(model.sections.first(where: { $0.section == .topicNotes })?.items.map(\.path) == [
            "memory/topic-a.md",
            "memory/topic-z.md",
        ])
        #expect(model.sections.first(where: { $0.section == .identity })?.items.map(\.path) == ["IDENTITY.md"])
        #expect(model.sections.first(where: { $0.section == .soul })?.items.map(\.path) == ["SOUL.md"])
        #expect(model.sections.first(where: { $0.section == .agentFiles })?.items.map(\.path) == [
            "AGENTS.md",
            "TOOLS.md",
            "HEARTBEAT.md",
        ])
        #expect(model.sections.flatMap(\.items).map(\.path).contains("USER.md") == false)
        #expect(model.sections.flatMap(\.items).map(\.path).contains("BOOTSTRAP.md") == false)
        #expect(model.sections.flatMap(\.items).map(\.path).contains("memory/backlog/2026-04-23/follow-up.md") == false)
        #expect(model.selectedDocument?.item.path == "MEMORY.md")
        #expect(model.selectedDocument?.content == "# Main\n")

        let projection = model.graphProjection
        #expect(projection.lanes.map(\.section) == model.sections.map(\.section))
        #expect(projection.lanes.flatMap(\.documentNodes).compactMap(\.relatedItemID) == model.sections.flatMap(\.items).map(\.id))
        #expect(projection.edges.count == model.sections.flatMap(\.items).count)
        #expect(projection.edges.allSatisfy { $0.sourceID.hasPrefix("section:") && $0.targetID.hasPrefix("item:") })
    }

    @Test func `keeps unsupported canonical files out of the surface and search`() async {
        let recorder = FileGetRecorder()
        let searchRecorder = SearchRecorder()
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "USER.md", kind: "preferences"),
                        Self.document(path: "BOOTSTRAP.md", kind: "setup_bootstrap"),
                        Self.document(path: "memory/backlog/2026-04-23/follow-up.md", kind: "backlog_note"),
                    ])),
            ],
            contents: [
                "USER.md": "# User\n",
                "BOOTSTRAP.md": "# Bootstrap\n",
                "memory/backlog/2026-04-23/follow-up.md": "# Backlog\nBoson summary.\n",
            ],
            onRead: { path in
                await recorder.record(path)
            },
            onSearch: { query in
                await searchRecorder.record(query)
            })

        await model.refresh()
        await model.search(query: "boson")

        #expect(
            model.listState
                == .empty(
                    "No daily notes, topic notes, main memory, identity, soul, or agent files are available yet."))
        #expect(model.sections.isEmpty)
        #expect(await recorder.paths.isEmpty)
        #expect(await searchRecorder.queries.isEmpty)
    }

    @Test func `search uses the gateway memory search contract`() async {
        let recorder = FileGetRecorder()
        let searchRecorder = SearchRecorder()
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
            searchResults: [
                "boson": MemorySearchToolResult(
                    disabled: nil,
                    error: nil,
                    results: [
                        MemorySearchToolMatch(
                            path: "memory://profiles/profile/pages/page-1/projections/projection-1",
                            displayPath: "memory/physics.md",
                            snippet: "Boson summary.",
                            pageId: "page-1",
                            projectionId: "projection-1"),
                    ]),
            ],
            onRead: { path in
                await recorder.record(path)
            },
            onSearch: { query in
                await searchRecorder.record(query)
            })

        await model.refresh()
        await model.search(query: "boson")

        #expect(model.listState == .list)
        #expect(model.sections.map(\.section) == [.topicNotes])
        #expect(model.sections.first?.items.map(\.path) == ["memory/physics.md"])
        #expect(model.graphProjection.lanes.map(\.section) == [.topicNotes])
        #expect(model.graphProjection.lanes.flatMap(\.documentNodes).compactMap(\.relatedItemID) == ["memory/physics.md"])
        #expect(model.graphProjection.edges.count == 1)
        #expect(await recorder.paths == ["MEMORY.md", "memory/physics.md"])
        #expect(await searchRecorder.queries == ["boson"])
        #expect(model.searchMatchesByItemID["memory/physics.md"]?.snippet == "Boson summary.")
    }

    @Test func `switching agents rebuilds the canonical selection coherently`() async {
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "MEMORY.md", kind: "main_memory"),
                    ])),
                MemoryAgentSummary(
                    id: "writer",
                    name: "Writer",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "SOUL.md", kind: "soul"),
                        Self.document(path: "AGENTS.md", kind: "agent_instructions"),
                    ])),
            ],
            contents: [
                "MEMORY.md": "# Main\n",
                "SOUL.md": "# Soul\n",
                "AGENTS.md": "# Agent\n",
            ])

        await model.refresh()
        #expect(model.selectedAgentID == "main")
        #expect(model.selectedDocument?.item.path == "MEMORY.md")

        await model.selectAgent("writer")

        #expect(model.selectedAgentID == "writer")
        #expect(model.sections.map(\.section) == [.soul, .agentFiles])
        #expect(model.selectedDocument?.item.path == "SOUL.md")
        #expect(model.selectedDocument?.content == "# Soul\n")
    }

    @Test func `graph node selection opens the related canonical context`() async throws {
        let model = Self.makeModel(
            agents: [
                MemoryAgentSummary(
                    id: "main",
                    name: "Main",
                    identity: nil,
                    personalContext: MemoryPersonalContextSummary(documents: [
                        Self.document(path: "MEMORY.md", kind: "main_memory"),
                        Self.document(path: "memory/2026-04-22.md", kind: "daily_note"),
                        Self.document(path: "memory/2026-04-23.md", kind: "daily_note"),
                        Self.document(path: "memory/physics.md", kind: "topic_note"),
                    ])),
            ],
            contents: [
                "MEMORY.md": "# Memory\nShort notes.\n",
                "memory/2026-04-22.md": "# Daily\nOlder.\n",
                "memory/2026-04-23.md": "# Daily\nLatest.\n",
                "memory/physics.md": "# Physics\nBoson summary.\n",
            ])

        await model.refresh()

        let topicNode = try #require(
            model.graphProjection.lanes
                .first(where: { $0.section == .topicNotes })?
                .documentNodes
                .first)
        await model.selectGraphNode(topicNode)
        #expect(model.selectedDocument?.item.path == "memory/physics.md")
        #expect(model.selectedDocument?.content == "# Physics\nBoson summary.\n")

        let dailySectionNode = try #require(
            model.graphProjection.lanes
                .first(where: { $0.section == .dailyNotes })?
                .sectionNode)
        await model.selectGraphNode(dailySectionNode)
        #expect(model.selectedDocument?.item.path == "memory/2026-04-23.md")
        #expect(model.selectedItemID == "memory/2026-04-23.md")
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
                },
                searchMemory: { _, _, _ in
                    MemorySearchToolResult(disabled: nil, error: nil, results: [])
                }),
            accountGate: { _ in .authenticated })

        await model.refresh()

        #expect(model.listState == .error("Gateway offline"))
        #expect(model.sections.isEmpty)
    }

    @Test func `search exposes gateway failures honestly when there are no metadata hits`() async {
        let model = MemorySettingsModel(
            client: MemorySettingsClient(
                listAgents: {
                    MemoryAgentsListResult(agents: [
                        MemoryAgentSummary(
                            id: "main",
                            name: "Main",
                            identity: nil,
                            personalContext: MemoryPersonalContextSummary(documents: [
                                Self.document(path: "MEMORY.md", kind: "main_memory"),
                            ])),
                    ])
                },
                readFile: { _, path in
                    MemoryAgentFilePayload(
                        name: URL(fileURLWithPath: path).lastPathComponent,
                        path: path,
                        missing: false,
                        size: 32,
                        updatedAtMs: 1_713_830_400_000,
                        content: "# Memory\nShort notes.\n")
                },
                searchMemory: { _, _, _ in
                    throw NSError(
                        domain: "Tests",
                        code: 8,
                        userInfo: [NSLocalizedDescriptionKey: "Memory search unavailable"])
                }),
            accountGate: { _ in .authenticated })

        await model.refresh()
        await model.search(query: "boson")

        #expect(model.listState == .error("Memory search unavailable"))
        #expect(model.sections.isEmpty)
    }

    private actor FileGetRecorder {
        private(set) var paths: [String] = []

        func record(_ path: String) {
            self.paths.append(path)
        }
    }

    private actor SearchRecorder {
        private(set) var queries: [String] = []

        func record(_ query: String) {
            self.queries.append(query)
        }
    }

    private static func makeClient(
        agents: [MemoryAgentSummary] = [],
        contents: [String: String] = [:],
        searchResults: [String: MemorySearchToolResult] = [:],
        onRead: (@Sendable (String) async -> Void)? = nil,
        onSearch: (@Sendable (String) async -> Void)? = nil) -> MemorySettingsClient
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
            },
            searchMemory: { _, query, _ in
                await onSearch?(query)
                return searchResults[query] ?? MemorySearchToolResult(
                    disabled: nil,
                    error: nil,
                    results: [])
            })
    }

    private static func makeModel(
        agents: [MemoryAgentSummary] = [],
        contents: [String: String] = [:],
        searchResults: [String: MemorySearchToolResult] = [:],
        onRead: (@Sendable (String) async -> Void)? = nil,
        onSearch: (@Sendable (String) async -> Void)? = nil) -> MemorySettingsModel
    {
        MemorySettingsModel(
            client: Self.makeClient(
                agents: agents,
                contents: contents,
                searchResults: searchResults,
                onRead: onRead,
                onSearch: onSearch),
            accountGate: { _ in .authenticated })
    }

    nonisolated private static func document(
        path: String,
        kind: String,
        group: String? = nil,
        indexed: Bool? = nil,
        present: Bool = true,
        size: Int? = 128,
        updatedAtMs: Int? = 1_713_830_400_000) -> MemoryPersonalContextDocument
    {
        MemoryPersonalContextDocument(
            path: path,
            kind: kind,
            group: group,
            indexed: indexed,
            present: present,
            size: size,
            updatedAtMs: updatedAtMs)
    }
}

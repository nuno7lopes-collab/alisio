import PackagePlugin

@main
struct AlisioSupportExportsPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target _: any Target) async throws -> [Command] {
        let tool = try context.tool(named: "AlisioSupportExportsTool")
        let outputDir = context.pluginWorkDirectoryURL.appending(path: "GeneratedSources", directoryHint: .isDirectory)
        let outputFile = outputDir.appending(path: "AlisioGeneratedExports.swift", directoryHint: .notDirectory)

        return [
            .buildCommand(
                displayName: "Generate Alisio support exports",
                executable: tool.url,
                arguments: [outputFile.path()],
                outputFiles: [outputFile]),
        ]
    }
}

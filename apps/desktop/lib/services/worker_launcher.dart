import "dart:async";
import "dart:convert";
import "dart:io";
import "worker_bridge_api.dart";

abstract class WorkerLauncher {
  Future<void> ensureStarted(WorkerBridgeApi bridge);
}

class LocalWorkerLauncher implements WorkerLauncher {
  LocalWorkerLauncher();

  static const String _defaultCommand =
      String.fromEnvironment("LUME_WORKER_COMMAND", defaultValue: "bun");
  static const String _defaultArgs = String.fromEnvironment(
    "LUME_WORKER_ARGS",
    defaultValue: "packages/desktop-worker/src/bin/lume-worker.ts --port 3500",
  );

  Process? _process;

  @override
  Future<void> ensureStarted(WorkerBridgeApi bridge) async {
    try {
      await bridge.healthcheck();
      return;
    } catch (_) {
      // O worker ainda não está disponível; arrancamos uma instância local.
    }

    final command = _defaultCommand;
    final args = _defaultArgs
        .split(RegExp(r"\s+"))
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toList();

    _process = await Process.start(
      command,
      args,
      mode: ProcessStartMode.normal,
      runInShell: true,
    );
    unawaited(_pipeLogs(_process!.stdout));
    unawaited(_pipeLogs(_process!.stderr));

    for (var attempt = 0; attempt < 20; attempt += 1) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      try {
        await bridge.healthcheck();
        return;
      } catch (_) {
        continue;
      }
    }

    throw Exception("O worker local não ficou pronto a tempo.");
  }

  Future<void> _pipeLogs(Stream<List<int>> stream) async {
    await for (final chunk in stream) {
      final message = utf8.decode(chunk, allowMalformed: true).trim();
      if (message.isNotEmpty) {
        // ignore: avoid_print
        print(message);
      }
    }
  }
}

import "package:flutter/material.dart";
import "package:flutter_test/flutter_test.dart";
import "package:lume_desktop/controllers/app_controller.dart";
import "package:lume_desktop/models.dart";
import "package:lume_desktop/screens/home_shell.dart";
import "package:lume_desktop/services/worker_bridge_api.dart";
import "package:lume_desktop/services/worker_launcher.dart";
import "package:lume_desktop/theme.dart";

class _FakeBridge implements WorkerBridgeApi {
  WorkerSession? _session = const WorkerSession(
    userId: "user-1",
    name: "Nuno",
    email: "nuno@example.com",
    sessionToken: "session-1",
  );

  WorkerSettingsModel _settings = const WorkerSettingsModel(
    provider: "openai",
    model: "gpt-5.4",
    hasOpenAiApiKey: true,
  );

  List<ChatMessageModel> _messages = const [
    ChatMessageModel(
      id: "1",
      role: "user",
      text: "Check the worker",
      createdAt: 1,
    ),
    ChatMessageModel(
      id: "2",
      role: "assistant",
      text: "Everything looks ready.",
      createdAt: 2,
    ),
  ];

  @override
  Future<void> healthcheck() async {}

  @override
  Future<List<ChatMessageModel>> getMessages() async => _messages;

  @override
  Future<WorkerSession?> getSession() async => _session;

  @override
  Future<WorkerSettingsModel> getSettings() async => _settings;

  @override
  Future<WorkerStatusModel> getStatus() async {
    return WorkerStatusModel(
      state: "ready",
      brandName: "Lume",
      hasSession: _session != null,
      hasOpenAiApiKey: _settings.hasOpenAiApiKey,
      model: _settings.model,
      port: 3500,
    );
  }

  @override
  Future<WorkerSession> registerMock({
    required String name,
    required String email,
  }) async {
    _session = WorkerSession(
      userId: "user-1",
      name: name,
      email: email,
      sessionToken: "session-2",
    );
    return _session!;
  }

  @override
  Future<void> logout() async {
    _session = null;
    _messages = const [];
  }

  @override
  Future<List<ChatMessageModel>> sendMessage(String content) async {
    _messages = [
      ..._messages,
      ChatMessageModel(
        id: "3",
        role: "user",
        text: content,
        createdAt: 3,
      ),
    ];
    return _messages;
  }

  @override
  Future<WorkerSettingsModel> updateSettings({
    required String openAiApiKey,
    required String model,
  }) async {
    _settings = WorkerSettingsModel(
      provider: "openai",
      model: model,
      hasOpenAiApiKey: openAiApiKey.isNotEmpty,
    );
    return _settings;
  }
}

class _FakeLauncher implements WorkerLauncher {
  @override
  Future<void> ensureStarted(WorkerBridgeApi bridge) async {}
}

void main() {
  testWidgets("renders the split shell with focused sidebar content", (tester) async {
    final controller = AppController(
      bridge: _FakeBridge(),
      launcher: _FakeLauncher(),
    );

    await controller.bootstrap();

    await tester.pumpWidget(
      MaterialApp(
        theme: buildLumeTheme(),
        home: HomeShell(controller: controller),
      ),
    );

    await tester.pump();

    expect(find.text("Lume"), findsOneWidget);
    expect(find.text("Mensagens"), findsOneWidget);
    expect(find.text("Resumo"), findsOneWidget);
    expect(find.text("Conta"), findsOneWidget);
    expect(find.text("Atualizar"), findsWidgets);
  });
}

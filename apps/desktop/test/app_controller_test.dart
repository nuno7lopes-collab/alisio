import "package:flutter_test/flutter_test.dart";
import "package:lume_desktop/controllers/app_controller.dart";
import "package:lume_desktop/models.dart";
import "package:lume_desktop/services/worker_bridge_api.dart";
import "package:lume_desktop/services/worker_launcher.dart";

class FakeBridge implements WorkerBridgeApi {
  WorkerSession? _session;
  WorkerSettingsModel _settings = const WorkerSettingsModel(
    provider: "openai",
    model: "gpt-5.4",
    hasOpenAiApiKey: false,
  );
  List<ChatMessageModel> _messages = const [];

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
      sessionToken: "session-1",
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
      ChatMessageModel(
        id: "1",
        role: "user",
        text: content,
        createdAt: 1,
      ),
      const ChatMessageModel(
        id: "2",
        role: "assistant",
        text: "Resposta local",
        createdAt: 2,
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

class FakeLauncher implements WorkerLauncher {
  @override
  Future<void> ensureStarted(WorkerBridgeApi bridge) async {}
}

void main() {
  test("bootstrap carrega status e settings", () async {
    final controller = AppController(
      bridge: FakeBridge(),
      launcher: FakeLauncher(),
    );

    await controller.bootstrap();

    expect(controller.workerStatus?.state, "ready");
    expect(controller.settings?.model, "gpt-5.4");
    expect(controller.isBooting, false);
  });

  test("criar sessão local atualiza o controlador", () async {
    final controller = AppController(
      bridge: FakeBridge(),
      launcher: FakeLauncher(),
    );

    await controller.bootstrap();
    await controller.createLocalAccount(name: "Nuno", email: "nuno@example.com");

    expect(controller.session?.email, "nuno@example.com");
  });

  test("enviar mensagem atualiza o transcript", () async {
    final controller = AppController(
      bridge: FakeBridge(),
      launcher: FakeLauncher(),
    );

    await controller.bootstrap();
    await controller.createLocalAccount(name: "Nuno", email: "nuno@example.com");
    await controller.sendChatMessage("Olá");

    expect(controller.messages, hasLength(2));
    expect(controller.messages.last.text, "Resposta local");
  });
}

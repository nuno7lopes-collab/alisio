import "package:flutter/foundation.dart";
import "../models.dart";
import "../services/worker_bridge_api.dart";
import "../services/worker_launcher.dart";

class AppController extends ChangeNotifier {
  AppController({
    required WorkerBridgeApi bridge,
    required WorkerLauncher launcher,
  })  : _bridge = bridge,
        _launcher = launcher;

  final WorkerBridgeApi _bridge;
  final WorkerLauncher _launcher;

  bool isBooting = true;
  bool isSending = false;
  String? bootstrapError;
  WorkerStatusModel? workerStatus;
  WorkerSession? session;
  WorkerSettingsModel? settings;
  List<ChatMessageModel> messages = const [];
  int selectedIndex = 0;

  Future<void> bootstrap() async {
    isBooting = true;
    bootstrapError = null;
    notifyListeners();
    try {
      await _launcher.ensureStarted(_bridge);
      await refresh();
    } catch (error) {
      bootstrapError = error.toString();
    } finally {
      isBooting = false;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    workerStatus = await _bridge.getStatus();
    session = await _bridge.getSession();
    settings = await _bridge.getSettings();
    messages = await _bridge.getMessages();
    notifyListeners();
  }

  Future<void> createLocalAccount({
    required String name,
    required String email,
  }) async {
    session = await _bridge.registerMock(name: name, email: email);
    await refresh();
  }

  Future<void> logout() async {
    await _bridge.logout();
    await refresh();
  }

  Future<void> saveSettings({
    required String apiKey,
    required String model,
  }) async {
    settings = await _bridge.updateSettings(openAiApiKey: apiKey, model: model);
    workerStatus = await _bridge.getStatus();
    notifyListeners();
  }

  Future<void> sendChatMessage(String content) async {
    if (content.trim().isEmpty) {
      return;
    }
    isSending = true;
    notifyListeners();
    try {
      messages = await _bridge.sendMessage(content);
    } finally {
      isSending = false;
      notifyListeners();
    }
  }

  void selectIndex(int index) {
    selectedIndex = index;
    notifyListeners();
  }
}

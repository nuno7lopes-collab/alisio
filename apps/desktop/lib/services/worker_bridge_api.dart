import "../models.dart";

abstract class WorkerBridgeApi {
  Future<void> healthcheck();
  Future<WorkerStatusModel> getStatus();
  Future<WorkerSession?> getSession();
  Future<WorkerSession> registerMock({
    required String name,
    required String email,
  });
  Future<void> logout();
  Future<WorkerSettingsModel> getSettings();
  Future<WorkerSettingsModel> updateSettings({
    required String openAiApiKey,
    required String model,
  });
  Future<List<ChatMessageModel>> getMessages();
  Future<List<ChatMessageModel>> sendMessage(String content);
}

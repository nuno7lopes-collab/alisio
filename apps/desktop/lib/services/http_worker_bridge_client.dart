import "dart:convert";
import "package:http/http.dart" as http;
import "../models.dart";
import "worker_bridge_api.dart";

class HttpWorkerBridgeClient implements WorkerBridgeApi {
  HttpWorkerBridgeClient({
    http.Client? client,
    Uri? baseUri,
  })  : _client = client ?? http.Client(),
        _baseUri = baseUri ?? Uri.parse("http://localhost:3500");

  final http.Client _client;
  final Uri _baseUri;

  Uri _uri(String path) => _baseUri.resolve(path);

  Future<Map<String, dynamic>> _readJsonResponse(http.Response response) async {
    if (response.statusCode >= 400) {
      throw Exception("Bridge local indisponível: ${response.statusCode} ${response.body}");
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  @override
  Future<void> healthcheck() async {
    final response = await _client.get(_uri("/healthz"));
    await _readJsonResponse(response);
  }

  @override
  Future<WorkerStatusModel> getStatus() async {
    final response = await _client.get(_uri("/worker/status"));
    return WorkerStatusModel.fromJson(await _readJsonResponse(response));
  }

  @override
  Future<WorkerSession?> getSession() async {
    final response = await _client.get(_uri("/auth/mock/session"));
    final payload = await _readJsonResponse(response);
    final session = payload["session"];
    if (session == null) {
      return null;
    }
    return WorkerSession.fromJson(session as Map<String, dynamic>);
  }

  @override
  Future<WorkerSession> registerMock({
    required String name,
    required String email,
  }) async {
    final response = await _client.post(
      _uri("/auth/mock/register"),
      headers: {
        "content-type": "application/json",
      },
      body: jsonEncode({
        "name": name,
        "email": email,
      }),
    );
    final payload = await _readJsonResponse(response);
    return WorkerSession.fromJson(payload["session"] as Map<String, dynamic>);
  }

  @override
  Future<void> logout() async {
    final response = await _client.post(_uri("/auth/mock/logout"));
    await _readJsonResponse(response);
  }

  @override
  Future<WorkerSettingsModel> getSettings() async {
    final response = await _client.get(_uri("/settings"));
    final payload = await _readJsonResponse(response);
    return WorkerSettingsModel.fromJson(payload["settings"] as Map<String, dynamic>);
  }

  @override
  Future<WorkerSettingsModel> updateSettings({
    required String openAiApiKey,
    required String model,
  }) async {
    final response = await _client.put(
      _uri("/settings"),
      headers: {
        "content-type": "application/json",
      },
      body: jsonEncode({
        "openAiApiKey": openAiApiKey,
        "model": model,
      }),
    );
    final payload = await _readJsonResponse(response);
    return WorkerSettingsModel.fromJson(payload["settings"] as Map<String, dynamic>);
  }

  @override
  Future<List<ChatMessageModel>> getMessages() async {
    final response = await _client.get(_uri("/chat/messages"));
    final payload = await _readJsonResponse(response);
    final transcript = payload["transcript"] as List<dynamic>;
    return transcript
        .map((entry) => ChatMessageModel.fromJson(entry as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<List<ChatMessageModel>> sendMessage(String content) async {
    final response = await _client.post(
      _uri("/chat/send"),
      headers: {
        "content-type": "application/json",
      },
      body: jsonEncode({
        "content": content,
      }),
    );
    final payload = await _readJsonResponse(response);
    final transcript = payload["transcript"] as List<dynamic>;
    return transcript
        .map((entry) => ChatMessageModel.fromJson(entry as Map<String, dynamic>))
        .toList();
  }
}

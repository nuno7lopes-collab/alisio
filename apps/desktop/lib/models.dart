class WorkerSession {
  const WorkerSession({
    required this.userId,
    required this.name,
    required this.email,
    required this.sessionToken,
  });

  final String userId;
  final String name;
  final String email;
  final String sessionToken;

  factory WorkerSession.fromJson(Map<String, dynamic> json) {
    return WorkerSession(
      userId: json["userId"] as String,
      name: json["name"] as String,
      email: json["email"] as String,
      sessionToken: json["sessionToken"] as String,
    );
  }
}

class WorkerStatusModel {
  const WorkerStatusModel({
    required this.state,
    required this.brandName,
    required this.hasSession,
    required this.hasOpenAiApiKey,
    required this.model,
    required this.port,
    this.lastError,
  });

  final String state;
  final String brandName;
  final bool hasSession;
  final bool hasOpenAiApiKey;
  final String model;
  final int port;
  final String? lastError;

  factory WorkerStatusModel.fromJson(Map<String, dynamic> json) {
    return WorkerStatusModel(
      state: json["state"] as String,
      brandName: json["brandName"] as String,
      hasSession: json["hasSession"] as bool,
      hasOpenAiApiKey: json["hasOpenAiApiKey"] as bool,
      model: json["model"] as String,
      port: json["port"] as int,
      lastError: json["lastError"] as String?,
    );
  }
}

class WorkerSettingsModel {
  const WorkerSettingsModel({
    required this.provider,
    required this.model,
    required this.hasOpenAiApiKey,
  });

  final String provider;
  final String model;
  final bool hasOpenAiApiKey;

  factory WorkerSettingsModel.fromJson(Map<String, dynamic> json) {
    return WorkerSettingsModel(
      provider: json["provider"] as String,
      model: json["model"] as String,
      hasOpenAiApiKey: json["hasOpenAiApiKey"] as bool,
    );
  }
}

class ChatMessageModel {
  const ChatMessageModel({
    required this.id,
    required this.role,
    required this.text,
    required this.createdAt,
    this.toolAlias,
    this.isError = false,
  });

  final String id;
  final String role;
  final String text;
  final int createdAt;
  final String? toolAlias;
  final bool isError;

  factory ChatMessageModel.fromJson(Map<String, dynamic> json) {
    return ChatMessageModel(
      id: json["id"] as String,
      role: json["role"] as String,
      text: json["text"] as String,
      createdAt: json["createdAt"] as int,
      toolAlias: json["toolAlias"] as String?,
      isError: json["isError"] as bool? ?? false,
    );
  }
}

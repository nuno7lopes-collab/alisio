import "package:flutter/material.dart";
import "app.dart";
import "controllers/app_controller.dart";
import "services/http_worker_bridge_client.dart";
import "services/worker_launcher.dart";

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = AppController(
    bridge: HttpWorkerBridgeClient(),
    launcher: LocalWorkerLauncher(),
  );
  runApp(LumeApp(controller: controller));
}

import "package:flutter/material.dart";
import "controllers/app_controller.dart";
import "screens/auth_screen.dart";
import "screens/home_shell.dart";
import "screens/splash_screen.dart";
import "theme.dart";

class LumeApp extends StatefulWidget {
  const LumeApp({
    super.key,
    required this.controller,
  });

  final AppController controller;

  @override
  State<LumeApp> createState() => _LumeAppState();
}

class _LumeAppState extends State<LumeApp> {
  @override
  void initState() {
    super.initState();
    widget.controller.bootstrap();
    widget.controller.addListener(_onControllerChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: "Lume",
      theme: buildLumeTheme(),
      home: Builder(
        builder: (context) {
          if (controller.isBooting || (controller.bootstrapError != null && controller.workerStatus == null)) {
            return SplashScreen(
              error: controller.bootstrapError,
              onRetry: () {
                controller.bootstrap();
              },
            );
          }
          if (controller.session == null) {
            return AuthScreen(
              onSubmit: (name, email) => controller.createLocalAccount(
                name: name,
                email: email,
              ),
            );
          }
          return HomeShell(controller: controller);
        },
      ),
    );
  }
}

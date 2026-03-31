import "package:flutter/material.dart";

import "../widgets/glass.dart";

class SplashScreen extends StatelessWidget {
  const SplashScreen({
    super.key,
    required this.error,
    required this.onRetry,
  });

  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: SectionCard(
            title: "Lume",
            description: error ?? "A preparar o runtime local.",
            icon: error == null ? Icons.hourglass_top_rounded : Icons.error_outline_rounded,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 6),
                if (error == null)
                  const LinearProgressIndicator()
                else
                  FilledButton(
                    onPressed: onRetry,
                    child: const Text("Tentar de novo"),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

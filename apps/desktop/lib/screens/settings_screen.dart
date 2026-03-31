import "package:flutter/material.dart";

import "../models.dart";
import "../widgets/glass.dart";

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.settings,
    required this.onSave,
  });

  final WorkerSettingsModel? settings;
  final Future<void> Function({
    required String apiKey,
    required String model,
  }) onSave;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _apiKeyController = TextEditingController();
  final TextEditingController _modelController = TextEditingController();

  bool _saving = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    final settings = widget.settings;
    if (settings == null) {
      return;
    }
    if (_modelController.text.isEmpty) {
      _modelController.text = settings.model;
    }
  }

  @override
  void dispose() {
    _apiKeyController.dispose();
    _modelController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.onSave(
        apiKey: _apiKeyController.text.trim(),
        model: _modelController.text.trim(),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Definições atualizadas.")),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = widget.settings;

    return ListView(
      children: [
        SectionCard(
          title: "OpenAI",
          description: "Ajusta apenas o que este dispositivo precisa para funcionar.",
          icon: Icons.tune_rounded,
          trailing: StatusPill(
            label: settings?.provider ?? "Local",
            color: theme.colorScheme.primary,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                settings?.hasOpenAiApiKey == true
                    ? "A API key atual já está guardada localmente."
                    : "Ainda não existe uma API key guardada neste dispositivo.",
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withOpacity(0.70),
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _apiKeyController,
                obscureText: _obscure,
                decoration: InputDecoration(
                  labelText: "API key",
                  hintText: "sk-...",
                  suffixIcon: IconButton(
                    onPressed: () => setState(() => _obscure = !_obscure),
                    icon: Icon(
                      _obscure ? Icons.visibility_off_rounded : Icons.visibility_rounded,
                    ),
                  ),
                  helperText: "Só é substituída se preencheres este campo.",
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _modelController,
                decoration: InputDecoration(
                  labelText: "Modelo",
                  hintText: settings?.model ?? "gpt-5.4",
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ActionChip(
                    label: const Text("gpt-5.4"),
                    onPressed: () => _modelController.text = "gpt-5.4",
                  ),
                  ActionChip(
                    label: const Text("gpt-5.4-mini"),
                    onPressed: () => _modelController.text = "gpt-5.4-mini",
                  ),
                ],
              ),
              const SizedBox(height: 18),
              FilledButton(
                onPressed: _saving ? null : _save,
                child: Text(_saving ? "A guardar" : "Guardar"),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

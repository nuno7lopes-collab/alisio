import "package:flutter/material.dart";

import "../widgets/glass.dart";

class AuthScreen extends StatefulWidget {
  const AuthScreen({
    super.key,
    required this.onSubmit,
  });

  final Future<void> Function(String name, String email) onSubmit;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await widget.onSubmit(_nameController.text, _emailController.text);
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: SectionCard(
            title: "Conta local",
            description: "Primeira fase sem cloud. A sessão fica só neste dispositivo.",
            icon: Icons.person_outline_rounded,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: "Nome"),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _emailController,
                  decoration: const InputDecoration(labelText: "Email"),
                ),
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: _submitting ? null : _submit,
                  child: Text(_submitting ? "A criar" : "Entrar"),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

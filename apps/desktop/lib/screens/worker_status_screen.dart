import "package:flutter/material.dart";

import "../models.dart";
import "../widgets/glass.dart";

class WorkerStatusScreen extends StatelessWidget {
  const WorkerStatusScreen({
    super.key,
    required this.status,
  });

  final WorkerStatusModel? status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = this.status;
    if (status == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final ready = status.state == "ready";
    final checks = [
      _CheckItem(
        label: "Worker",
        value: ready ? "Pronto" : "A iniciar",
        ok: ready,
      ),
      _CheckItem(
        label: "Sessão",
        value: status.hasSession ? "Ligada" : "Em falta",
        ok: status.hasSession,
      ),
      _CheckItem(
        label: "Credencial",
        value: status.hasOpenAiApiKey ? "API key local" : "Sem credencial",
        ok: status.hasOpenAiApiKey,
      ),
    ];
    final guidance = <String>[
      if (!ready) "Espera pelo arranque do runtime antes de enviares pedidos.",
      if (!status.hasSession) "Inicia sessão para ligar a conversa a uma conta local.",
      if (!status.hasOpenAiApiKey) "Adiciona uma API key em Definições para ativar respostas.",
    ];

    return ListView(
      children: [
        SectionCard(
          title: "Saúde",
          description: "Só o estado essencial que bloqueia ou permite continuar.",
          icon: Icons.memory_rounded,
          trailing: StatusPill(
            label: ready ? "Pronto" : status.state,
            color: ready ? theme.colorScheme.secondary : theme.colorScheme.primary,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final check in checks) ...[
                _CheckRow(check: check),
                if (check != checks.last)
                  Divider(color: theme.colorScheme.onSurface.withOpacity(0.08), height: 20),
              ],
            ],
          ),
        ),
        if (status.lastError case final error?) ...[
          const SizedBox(height: 16),
          SectionCard(
            title: "Erro",
            icon: Icons.error_outline_rounded,
            backgroundColor: const Color(0xFFFFF4F1),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(error, style: theme.textTheme.bodyLarge),
              ],
            ),
          ),
        ],
        if (guidance.isNotEmpty) ...[
          const SizedBox(height: 16),
          SectionCard(
            title: "Próximo passo",
            icon: Icons.arrow_circle_right_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in guidance) ...[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Icon(
                          Icons.arrow_forward_rounded,
                          size: 16,
                          color: theme.colorScheme.onSurface.withOpacity(0.58),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          item,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.72),
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (item != guidance.last) const SizedBox(height: 10),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _CheckItem {
  const _CheckItem({
    required this.label,
    required this.value,
    required this.ok,
  });

  final String label;
  final String value;
  final bool ok;
}

class _CheckRow extends StatelessWidget {
  const _CheckRow({
    required this.check,
  });

  final _CheckItem check;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = check.ok ? theme.colorScheme.secondary : theme.colorScheme.primary;
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(999),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(check.label, style: theme.textTheme.titleMedium),
        ),
        Text(
          check.value,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.58),
          ),
        ),
      ],
    );
  }
}

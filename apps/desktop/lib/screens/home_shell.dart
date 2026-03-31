import "package:flutter/material.dart";

import "../controllers/app_controller.dart";
import "../widgets/glass.dart";
import "chat_screen.dart";
import "settings_screen.dart";
import "worker_status_screen.dart";

class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.controller,
  });

  final AppController controller;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  final ScrollController _secondarySidebarScrollController = ScrollController();
  bool _refreshing = false;

  static const _pages = [
    _ShellPage(
      index: 0,
      title: "Chat",
      subtitle: "Conversa contínua com este assistente local.",
      icon: Icons.chat_bubble_outline_rounded,
      accent: Color(0xFF3478F6),
    ),
    _ShellPage(
      index: 1,
      title: "Runtime",
      subtitle: "Saúde operacional, sessão e erros do runtime local.",
      icon: Icons.memory_rounded,
      accent: Color(0xFF14866D),
    ),
    _ShellPage(
      index: 2,
      title: "Definições",
      subtitle: "Credenciais e defaults locais deste dispositivo.",
      icon: Icons.tune_rounded,
      accent: Color(0xFF7A8798),
    ),
  ];

  @override
  void dispose() {
    _secondarySidebarScrollController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_refreshing) {
      return;
    }
    setState(() => _refreshing = true);
    try {
      await widget.controller.refresh();
    } finally {
      if (mounted) {
        setState(() => _refreshing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final selectedPage = _pages[controller.selectedIndex];
    final screens = [
      ChatScreen(
        key: const PageStorageKey("chat-screen"),
        messages: controller.messages,
        isSending: controller.isSending,
        onSend: controller.sendChatMessage,
      ),
      WorkerStatusScreen(
        key: const PageStorageKey("worker-screen"),
        status: controller.workerStatus,
      ),
      SettingsScreen(
        key: const PageStorageKey("settings-screen"),
        settings: controller.settings,
        onSave: controller.saveSettings,
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 1320;
        final railWidth = compact ? 84.0 : 92.0;
        final secondarySidebarWidth = compact ? 304.0 : 340.0;

        return Scaffold(
          body: DecoratedBox(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFF1F4F7),
                  Color(0xFFF8FAFB),
                  Color(0xFFF0F3F6),
                ],
              ),
            ),
            child: Stack(
              children: [
                const _ShellGlow(
                  alignment: Alignment(-1.12, -1.02),
                  size: 360,
                  color: Color(0x123478F6),
                ),
                const _ShellGlow(
                  alignment: Alignment(1.08, -0.84),
                  size: 340,
                  color: Color(0x1014866D),
                ),
                const _ShellGlow(
                  alignment: Alignment(0.92, 1.12),
                  size: 380,
                  color: Color(0x0C111827),
                ),
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: railWidth,
                          child: _PrimaryRail(
                            pages: _pages,
                            selectedIndex: controller.selectedIndex,
                            onSelect: controller.selectIndex,
                            onLogout: controller.logout,
                          ),
                        ),
                        const SizedBox(width: 14),
                        SizedBox(
                          width: secondarySidebarWidth,
                          child: _SecondarySidebar(
                            controller: controller,
                            selectedPage: selectedPage,
                            scrollController: _secondarySidebarScrollController,
                            refreshing: _refreshing,
                            onRefresh: _refresh,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: _MainStage(
                            controller: controller,
                            selectedPage: selectedPage,
                            refreshing: _refreshing,
                            onRefresh: _refresh,
                            child: IndexedStack(
                              index: controller.selectedIndex,
                              children: screens,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _PrimaryRail extends StatelessWidget {
  const _PrimaryRail({
    required this.pages,
    required this.selectedIndex,
    required this.onSelect,
    required this.onLogout,
  });

  final List<_ShellPage> pages;
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
      borderRadius: BorderRadius.circular(32),
      backgroundColor: Colors.white.withOpacity(0.48),
      child: Column(
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: theme.colorScheme.onSurface,
              borderRadius: BorderRadius.circular(22),
            ),
            child: SizedBox(
              height: 54,
              width: 54,
              child: Center(
                child: Text(
                  "L",
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: theme.colorScheme.surface,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            "Lume",
            style: theme.textTheme.labelLarge?.copyWith(
              fontWeight: FontWeight.w700,
              color: theme.colorScheme.onSurface.withOpacity(0.68),
            ),
          ),
          const SizedBox(height: 20),
          for (final page in pages) ...[
            _RailButton(
              icon: page.icon,
              label: page.title,
              selected: selectedIndex == page.index,
              accent: page.accent,
              onTap: () {
                onSelect(page.index);
              },
            ),
            const SizedBox(height: 10),
          ],
          const Spacer(),
          _RailButton(
            icon: Icons.logout_rounded,
            label: "Sair",
            selected: false,
            accent: const Color(0xFF7A8798),
            onTap: () {
              onLogout();
            },
          ),
        ],
      ),
    );
  }
}

class _RailButton extends StatelessWidget {
  const _RailButton({
    required this.icon,
    required this.label,
    required this.selected,
    required this.accent,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Tooltip(
      message: label,
      waitDuration: const Duration(milliseconds: 250),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            height: 58,
            width: 58,
            decoration: BoxDecoration(
              color: selected
                  ? accent.withOpacity(0.14)
                  : theme.colorScheme.onSurface.withOpacity(0.03),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected
                    ? accent.withOpacity(0.28)
                    : theme.colorScheme.onSurface.withOpacity(0.08),
              ),
            ),
            child: Icon(
              icon,
              color: selected ? accent : theme.colorScheme.onSurface.withOpacity(0.70),
            ),
          ),
        ),
      ),
    );
  }
}

class _SecondarySidebar extends StatelessWidget {
  const _SecondarySidebar({
    required this.controller,
    required this.selectedPage,
    required this.scrollController,
    required this.refreshing,
    required this.onRefresh,
  });

  final AppController controller;
  final _ShellPage selectedPage;
  final ScrollController scrollController;
  final bool refreshing;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return GlassPanel(
      padding: EdgeInsets.zero,
      borderRadius: BorderRadius.circular(32),
      backgroundColor: Colors.white.withOpacity(0.50),
      child: Scrollbar(
        controller: scrollController,
        thumbVisibility: true,
        child: SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: selectedPage.accent.withOpacity(0.14),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Icon(
                        selectedPage.icon,
                        color: selectedPage.accent,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          selectedPage.title,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          selectedPage.subtitle,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurface.withOpacity(0.62),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              OutlinedButton.icon(
                onPressed: refreshing
                    ? null
                    : () {
                        onRefresh();
                      },
                icon: Icon(
                  refreshing ? Icons.hourglass_top_rounded : Icons.refresh_rounded,
                ),
                label: Text(refreshing ? "A atualizar" : "Atualizar"),
              ),
              const SizedBox(height: 18),
              ..._buildContextCards(context),
              const SizedBox(height: 12),
              _SecondaryCard(
                title: "Conta",
                icon: Icons.person_outline_rounded,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      controller.session?.name ?? "Sessão local",
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      controller.session?.email ?? "Sem email disponível",
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface.withOpacity(0.60),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _buildContextCards(BuildContext context) {
    switch (selectedPage.index) {
      case 0:
        return _buildChatContext(context);
      case 1:
        return _buildRuntimeContext(context);
      case 2:
        return _buildSettingsContext(context);
      default:
        return const [];
    }
  }

  List<Widget> _buildChatContext(BuildContext context) {
    final theme = Theme.of(context);
    final latest = controller.messages.isEmpty ? null : controller.messages.last;

    return [
      _SecondaryCard(
        title: "Resumo",
        icon: Icons.forum_outlined,
        child: Column(
          children: [
            _ContextRow(
              label: "Mensagens",
              value: "${controller.messages.length}",
            ),
            _ContextRow(
              label: "Última origem",
              value: latest == null ? "Sem atividade" : _roleLabel(latest.role),
            ),
            _ContextRow(
              label: "Estado",
              value: controller.isSending ? "A responder" : "Pronto",
              isLast: true,
            ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      _SecondaryCard(
        title: "Última mensagem",
        icon: Icons.history_toggle_off_rounded,
        child: Text(
          latest?.text.trim().isNotEmpty == true
              ? latest!.text
              : "Ainda não há conversa. Começa com um pedido direto e esta vista mantém sempre o último contexto visível.",
          maxLines: 6,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurface.withOpacity(0.72),
            height: 1.45,
          ),
        ),
      ),
      const SizedBox(height: 12),
      const _SecondaryCard(
        title: "Atalhos",
        icon: Icons.keyboard_command_key_rounded,
        child: Column(
          children: [
            _ShortcutLine(
              keys: "Enter",
              description: "Envia a mensagem atual",
            ),
            SizedBox(height: 10),
            _ShortcutLine(
              keys: "Shift + Enter",
              description: "Insere uma nova linha no composer",
            ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _buildRuntimeContext(BuildContext context) {
    final status = controller.workerStatus;
    final theme = Theme.of(context);

    return [
      _SecondaryCard(
        title: "Saúde",
        icon: Icons.memory_rounded,
        child: Column(
          children: [
            _ContextRow(
              label: "Runtime",
              value: status == null
                  ? "A iniciar"
                  : status.state == "ready"
                      ? "Pronto"
                      : status.state,
            ),
            _ContextRow(
              label: "Sessão",
              value: status?.hasSession == true ? "Ligada" : "Em falta",
            ),
            _ContextRow(
              label: "Chave OpenAI",
              value: status?.hasOpenAiApiKey == true ? "Presente" : "Em falta",
              isLast: true,
            ),
          ],
        ),
      ),
      if (status?.lastError?.trim().isNotEmpty == true) ...[
        const SizedBox(height: 12),
        _SecondaryCard(
          title: "Erro",
          icon: Icons.error_outline_rounded,
          child: Text(
            status!.lastError!,
            maxLines: 6,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              color: const Color(0xFF8A353A),
              height: 1.45,
            ),
          ),
        ),
      ],
    ];
  }

  List<Widget> _buildSettingsContext(BuildContext context) {
    final settings = controller.settings;

    return [
      _SecondaryCard(
        title: "Estado local",
        icon: Icons.settings_suggest_rounded,
        child: Column(
          children: [
            _ContextRow(
              label: "Provider",
              value: settings?.provider ?? "A carregar",
            ),
            _ContextRow(
              label: "Chave OpenAI",
              value: settings?.hasOpenAiApiKey == true ? "Guardada" : "Em falta",
              isLast: true,
            ),
          ],
        ),
      ),
      const SizedBox(height: 12),
      const _SecondaryCard(
        title: "Persistência",
        icon: Icons.lock_outline_rounded,
        child: Column(
          children: [
            _ContextRow(
              label: "Âmbito",
              value: "Só neste desktop",
            ),
            _ContextRow(
              label: "Aplicação",
              value: "Depois de guardar",
            ),
            _ContextRow(
              label: "Sessão",
              value: "Gerida à parte",
              isLast: true,
            ),
          ],
        ),
      ),
    ];
  }

  String _roleLabel(String role) {
    switch (role) {
      case "user":
        return "Tu";
      case "assistant":
        return "Assistente";
      case "tool":
        return "Ferramenta";
      case "system":
        return "Sistema";
      default:
        return role;
    }
  }
}

class _MainStage extends StatelessWidget {
  const _MainStage({
    required this.controller,
    required this.selectedPage,
    required this.refreshing,
    required this.onRefresh,
    required this.child,
  });

  final AppController controller;
  final _ShellPage selectedPage;
  final bool refreshing;
  final Future<void> Function() onRefresh;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final status = controller.workerStatus;

    return GlassPanel(
      padding: EdgeInsets.zero,
      borderRadius: BorderRadius.circular(34),
      backgroundColor: Colors.white.withOpacity(0.56),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 18),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        selectedPage.title,
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        selectedPage.subtitle,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withOpacity(0.62),
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusPill(
                      label: controller.session?.email ?? "Sessão local",
                      color: theme.colorScheme.onSurface.withOpacity(0.60),
                      icon: Icons.person_outline_rounded,
                    ),
                    if (status != null && selectedPage.index == 1)
                      StatusPill(
                        label: status.state == "ready" ? "Pronto" : status.state,
                        color: _statusColor(status.state),
                        icon: Icons.radar_rounded,
                      ),
                    FilledButton.icon(
                      onPressed: refreshing
                          ? null
                          : () {
                              onRefresh();
                            },
                      icon: Icon(
                        refreshing ? Icons.hourglass_top_rounded : Icons.refresh_rounded,
                      ),
                      label: Text(refreshing ? "A atualizar" : "Atualizar"),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Divider(
            height: 1,
            thickness: 1,
            color: theme.colorScheme.onSurface.withOpacity(0.07),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: child,
            ),
          ),
        ],
      ),
    );
  }

  Color _statusColor(String state) {
    switch (state) {
      case "ready":
        return const Color(0xFF14866D);
      case "error":
        return const Color(0xFFC04648);
      default:
        return const Color(0xFF6B7280);
    }
  }
}

class _SecondaryCard extends StatelessWidget {
  const _SecondaryCard({
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: title,
      icon: icon,
      child: child,
    );
  }
}

class _ContextRow extends StatelessWidget {
  const _ContextRow({
    required this.label,
    required this.value,
    this.isLast = false,
  });

  final String label;
  final String value;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.54),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ShortcutLine extends StatelessWidget {
  const _ShortcutLine({
    required this.keys,
    required this.description,
  });

  final String keys;
  final String description;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: theme.colorScheme.onSurface.withOpacity(0.05),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: theme.colorScheme.onSurface.withOpacity(0.08),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Text(
              keys,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              description,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withOpacity(0.62),
                height: 1.35,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ShellGlow extends StatelessWidget {
  const _ShellGlow({
    required this.alignment,
    required this.size,
    required this.color,
  });

  final Alignment alignment;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Align(
        alignment: alignment,
        child: DecoratedBox(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: color,
                blurRadius: 120,
                spreadRadius: 46,
              ),
            ],
          ),
          child: SizedBox.square(dimension: size),
        ),
      ),
    );
  }
}

class _ShellPage {
  const _ShellPage({
    required this.index,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accent,
  });

  final int index;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accent;
}

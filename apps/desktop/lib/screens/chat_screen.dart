import "package:flutter/material.dart";
import "package:flutter/services.dart";

import "../models.dart";
import "../widgets/glass.dart";

class ChatScreen extends StatefulWidget {
  const ChatScreen({
    super.key,
    required this.messages,
    required this.isSending,
    required this.onSend,
  });

  final List<ChatMessageModel> messages;
  final bool isSending;
  final Future<void> Function(String content) onSend;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  static const _quickPrompts = [
    "Resume o estado atual.",
    "Que conta AI está ativa?",
    "Explica o último erro.",
  ];

  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  @override
  void didUpdateWidget(covariant ChatScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  bool get _canSend => !widget.isSending && _controller.text.trim().isNotEmpty;

  Future<void> _submit() async {
    final content = _controller.text.trim();
    if (content.isEmpty || widget.isSending) {
      return;
    }
    _controller.clear();
    setState(() {});
    await widget.onSend(content);
  }

  void _usePrompt(String prompt) {
    _controller.text = prompt;
    _controller.selection = TextSelection.collapsed(offset: prompt.length);
    setState(() {});
  }

  String _formatTime(int createdAt) {
    final normalized = createdAt < 100000000000 ? createdAt * 1000 : createdAt;
    final date = DateTime.fromMillisecondsSinceEpoch(normalized).toLocal();
    final hour = date.hour.toString().padLeft(2, "0");
    final minute = date.minute.toString().padLeft(2, "0");
    return "$hour:$minute";
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasMessages = widget.messages.isNotEmpty;
    final statusLabel = widget.isSending ? "A responder" : "Pronto";

    return Column(
      children: [
        Expanded(
          child: GlassPanel(
            padding: EdgeInsets.zero,
            backgroundColor: Colors.white.withOpacity(0.72),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text("Mensagens", style: theme.textTheme.titleLarge),
                            const SizedBox(height: 4),
                            Text(
                              hasMessages
                                  ? "${widget.messages.length} mensagens na conversa atual."
                                  : "Sem conversa ainda. Podes começar com um pedido curto.",
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurface.withOpacity(0.64),
                                height: 1.4,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      StatusPill(
                        label: statusLabel,
                        color: widget.isSending
                            ? theme.colorScheme.primary
                            : theme.colorScheme.secondary,
                      ),
                    ],
                  ),
                ),
                Divider(
                  height: 1,
                  thickness: 1,
                  color: theme.colorScheme.onSurface.withOpacity(0.08),
                ),
                Expanded(
                  child: hasMessages
                      ? Scrollbar(
                          controller: _scrollController,
                          thumbVisibility: true,
                          child: ListView.separated(
                            controller: _scrollController,
                            padding: const EdgeInsets.all(20),
                            itemCount: widget.messages.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 12),
                            itemBuilder: (context, index) {
                              final message = widget.messages[index];
                              return _Bubble(
                                message: message,
                                timestamp: _formatTime(message.createdAt),
                              );
                            },
                          ),
                        )
                      : _EmptyState(
                          prompts: _quickPrompts,
                          onPromptSelected: _usePrompt,
                      ),
                ),
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: theme.colorScheme.onSurface.withOpacity(0.08),
                      ),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Shortcuts(
                        shortcuts: const {
                          SingleActivator(LogicalKeyboardKey.enter): _SendIntent(),
                        },
                        child: Actions(
                          actions: {
                            _SendIntent: CallbackAction<_SendIntent>(
                              onInvoke: (_) {
                                if (_canSend) {
                                  _submit();
                                }
                                return null;
                              },
                            ),
                          },
                          child: TextField(
                            controller: _controller,
                            minLines: 1,
                            maxLines: 6,
                            decoration: const InputDecoration(
                              hintText: "Escreve uma mensagem",
                            ),
                            onChanged: (_) => setState(() {}),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Text(
                            "Enter para enviar",
                            style: theme.textTheme.labelLarge,
                          ),
                          const Spacer(),
                          FilledButton(
                            onPressed: _canSend ? _submit : null,
                            child: Text(widget.isSending ? "A enviar" : "Enviar"),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SendIntent extends Intent {
  const _SendIntent();
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.prompts,
    required this.onPromptSelected,
  });

  final List<String> prompts;
  final ValueChanged<String> onPromptSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Ainda sem mensagens.",
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                "Começa por um pedido simples ou usa um dos atalhos.",
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 18),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.center,
                children: prompts
                    .map(
                      (prompt) => ActionChip(
                        label: Text(prompt),
                        onPressed: () => onPromptSelected(prompt),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    required this.timestamp,
  });

  final ChatMessageModel message;
  final String timestamp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isUser = message.role == "user";
    final color = isUser
        ? theme.colorScheme.primary.withOpacity(0.12)
        : message.isError
            ? const Color(0xFFF8D9D3)
            : Colors.white;
    final border = isUser
        ? theme.colorScheme.primary.withOpacity(0.16)
        : theme.colorScheme.onSurface.withOpacity(0.08);

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    isUser ? "Tu" : _labelForRole(message.role),
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: theme.colorScheme.onSurface.withOpacity(0.54),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    timestamp,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: theme.colorScheme.onSurface.withOpacity(0.42),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                message.text,
                style: theme.textTheme.bodyLarge?.copyWith(height: 1.5),
              ),
              if (message.toolAlias case final alias?) ...[
                const SizedBox(height: 10),
                StatusPill(
                  label: alias,
                  color: theme.colorScheme.secondary,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _labelForRole(String role) {
    switch (role) {
      case "assistant":
        return "Lume";
      case "tool":
        return "Ferramenta";
      case "system":
        return "Sistema";
      default:
        return role;
    }
  }
}

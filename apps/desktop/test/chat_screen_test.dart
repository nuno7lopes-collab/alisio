import "package:flutter/material.dart";
import "package:flutter/services.dart";
import "package:flutter_test/flutter_test.dart";
import "package:lume_desktop/models.dart";
import "package:lume_desktop/screens/chat_screen.dart";
import "package:lume_desktop/theme.dart";

void main() {
  testWidgets("renders the conversation and composer", (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildLumeTheme(),
        home: Scaffold(
          body: ChatScreen(
            messages: const [
              ChatMessageModel(
                id: "1",
                role: "user",
                text: "Hello",
                createdAt: 1,
              ),
              ChatMessageModel(
                id: "2",
                role: "assistant",
                text: "Local reply",
                createdAt: 2,
              ),
            ],
            isSending: false,
            onSend: (_) async {},
          ),
        ),
      ),
    );

    expect(find.text("Mensagens"), findsOneWidget);
    expect(find.text("Hello"), findsOneWidget);
    expect(find.text("Local reply"), findsOneWidget);
    expect(find.text("Enter para enviar"), findsOneWidget);
  });

  testWidgets("submits the composer with Enter", (tester) async {
    final sent = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        theme: buildLumeTheme(),
        home: Scaffold(
          body: ChatScreen(
            messages: const [],
            isSending: false,
            onSend: (value) async {
              sent.add(value);
            },
          ),
        ),
      ),
    );

    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.enterText(find.byType(TextField), "Check the worker");
    await tester.sendKeyDownEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.enter);
    await tester.pump();

    expect(sent, ["Check the worker"]);
  });
}

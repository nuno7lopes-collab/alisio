package ai.alisio.app.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.alisio.app.ChatAssistantIdentity
import ai.alisio.app.chat.ChatMessage
import ai.alisio.app.chat.ChatMessageContent
import ai.alisio.app.chat.ChatPendingToolCall
import ai.alisio.app.tools.ToolDisplayRegistry
import ai.alisio.app.ui.mobileAccent
import ai.alisio.app.ui.mobileAccentSoft
import ai.alisio.app.ui.mobileBorder
import ai.alisio.app.ui.mobileBorderStrong
import ai.alisio.app.ui.mobileCallout
import ai.alisio.app.ui.mobileCaption1
import ai.alisio.app.ui.mobileCaption2
import ai.alisio.app.ui.mobileCardSurface
import ai.alisio.app.ui.mobileCodeBg
import ai.alisio.app.ui.mobileCodeBorder
import ai.alisio.app.ui.mobileCodeText
import ai.alisio.app.ui.mobileHeadline
import ai.alisio.app.ui.mobileText
import ai.alisio.app.ui.mobileTextSecondary
import ai.alisio.app.ui.mobileWarning
import ai.alisio.app.ui.mobileWarningSoft
import java.util.Locale

private data class ChatBubbleStyle(
  val alignEnd: Boolean,
  val containerColor: Color,
  val borderColor: Color,
  val roleColor: Color,
)

@Composable
fun ChatMessageBubble(message: ChatMessage, assistantIdentity: ChatAssistantIdentity) {
  val role = message.role.trim().lowercase(Locale.US)
  val style = bubbleStyle(role)

  // Filter to only displayable content parts (text with content, or base64 images).
  val displayableContent =
    message.content.filter { part ->
      when (part.type) {
        "text" -> !part.text.isNullOrBlank()
        else -> part.base64 != null
      }
    }

  if (displayableContent.isEmpty()) return

  ChatBubbleContainer(
    style = style,
    roleLabel = roleLabel(role, assistantIdentity),
    avatar =
      if (role == "assistant") {
        { ChatAssistantAvatar(identity = assistantIdentity) }
      } else {
        null
      },
  ) {
    ChatMessageBody(content = displayableContent, textColor = mobileText)
  }
}

@Composable
private fun ChatBubbleContainer(
  style: ChatBubbleStyle,
  roleLabel: String,
  avatar: (@Composable () -> Unit)? = null,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  Row(
    modifier = modifier.fillMaxWidth(),
    horizontalArrangement = if (style.alignEnd) Arrangement.End else Arrangement.Start,
    verticalAlignment = Alignment.Top,
  ) {
    if (!style.alignEnd && avatar != null) {
      Box(modifier = Modifier.padding(top = 2.dp, end = 8.dp)) {
        avatar()
      }
    }
    Surface(
      shape = RoundedCornerShape(12.dp),
      border = BorderStroke(1.dp, style.borderColor),
      color = style.containerColor,
      tonalElevation = 0.dp,
      shadowElevation = 0.dp,
      modifier = Modifier.fillMaxWidth(0.90f),
    ) {
      Column(
        modifier = Modifier.padding(horizontal = 11.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
      ) {
        Text(
          text = roleLabel,
          style = mobileCaption2.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
          color = style.roleColor,
        )
        content()
      }
    }
  }
}

@Composable
private fun ChatMessageBody(content: List<ChatMessageContent>, textColor: Color) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (part in content) {
      when (part.type) {
        "text" -> {
          val text = part.text ?: continue
          ChatMarkdown(text = text, textColor = textColor)
        }
        else -> {
          val b64 = part.base64 ?: continue
          ChatBase64Image(base64 = b64, mimeType = part.mimeType)
        }
      }
    }
  }
}

@Composable
fun ChatTypingIndicatorBubble(assistantIdentity: ChatAssistantIdentity) {
  ChatBubbleContainer(
    style = bubbleStyle("assistant"),
    roleLabel = roleLabel("assistant", assistantIdentity),
    avatar = { ChatAssistantAvatar(identity = assistantIdentity) },
  ) {
    Row(
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      DotPulse(color = mobileTextSecondary)
      Text("Thinking...", style = mobileCallout, color = mobileTextSecondary)
    }
  }
}

@Composable
fun ChatPendingToolsBubble(
  toolCalls: List<ChatPendingToolCall>,
  assistantIdentity: ChatAssistantIdentity,
) {
  val context = LocalContext.current
  val displays =
    remember(toolCalls, context) {
      toolCalls.map { ToolDisplayRegistry.resolve(context, it.name, it.args) }
    }

  ChatBubbleContainer(
    style = bubbleStyle("assistant"),
    roleLabel = "${roleLabel("assistant", assistantIdentity)} · Tools",
    avatar = { ChatAssistantAvatar(identity = assistantIdentity) },
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text("Running tools...", style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold), color = mobileTextSecondary)
      for (display in displays.take(6)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text(
            "${display.emoji} ${display.label}",
            style = mobileCallout,
            color = mobileTextSecondary,
            fontFamily = FontFamily.Monospace,
          )
          display.detailLine?.let { detail ->
            Text(
              detail,
              style = mobileCaption1,
              color = mobileTextSecondary,
              fontFamily = FontFamily.Monospace,
            )
          }
        }
      }
      if (toolCalls.size > 6) {
        Text(
          text = "... +${toolCalls.size - 6} more",
          style = mobileCaption1,
          color = mobileTextSecondary,
        )
      }
    }
  }
}

@Composable
fun ChatStreamingAssistantBubble(text: String, assistantIdentity: ChatAssistantIdentity) {
  ChatBubbleContainer(
    style = bubbleStyle("assistant").copy(borderColor = mobileAccent),
    roleLabel = "${roleLabel("assistant", assistantIdentity)} · Live",
    avatar = { ChatAssistantAvatar(identity = assistantIdentity) },
  ) {
    ChatMarkdown(text = text, textColor = mobileText)
  }
}

@Composable
private fun bubbleStyle(role: String): ChatBubbleStyle {
  return when (role) {
    "user" ->
      ChatBubbleStyle(
        alignEnd = true,
        containerColor = mobileAccentSoft,
        borderColor = mobileAccent,
        roleColor = mobileAccent,
      )

    "system" ->
      ChatBubbleStyle(
        alignEnd = false,
        containerColor = mobileWarningSoft,
        borderColor = mobileWarning.copy(alpha = 0.45f),
        roleColor = mobileWarning,
      )

    else ->
      ChatBubbleStyle(
        alignEnd = false,
        containerColor = mobileCardSurface,
        borderColor = mobileBorderStrong,
        roleColor = mobileTextSecondary,
      )
  }
}

private fun roleLabel(role: String, assistantIdentity: ChatAssistantIdentity): String {
  return when (role) {
    "user" -> "You"
    "system" -> "System"
    else -> assistantIdentity.name.trim().ifEmpty { "Assistant" }
  }
}

@Composable
private fun ChatAssistantAvatar(identity: ChatAssistantIdentity) {
  val avatarUrl = identity.avatarUrl?.trim().orEmpty().ifEmpty {
    identity.avatar?.trim().takeIf { value ->
      !value.isNullOrEmpty() &&
        (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/"))
    }
  }
  val imageState = rememberAvatarImageState(avatarUrl)
  val badge =
    identity.avatar?.trim().takeIf { value ->
      !value.isNullOrEmpty() &&
        !value.startsWith("http://") &&
        !value.startsWith("https://") &&
        !value.startsWith("data:image/")
    } ?: identity.name.trim().take(1).uppercase(Locale.US).ifEmpty { "A" }

  Surface(
    modifier = Modifier.size(30.dp),
    shape = CircleShape,
    color = mobileCardSurface,
    border = BorderStroke(1.dp, mobileBorderStrong),
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
  ) {
    if (imageState.image != null) {
      Image(
        bitmap = imageState.image,
        contentDescription = identity.name,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(30.dp),
      )
    } else {
      Box(contentAlignment = Alignment.Center) {
        Text(
          text = badge,
          style = mobileCaption2.copy(fontWeight = FontWeight.Bold),
          color = mobileTextSecondary,
        )
      }
    }
  }
}

@Composable
private fun ChatBase64Image(base64: String, mimeType: String?) {
  val imageState = rememberBase64ImageState(base64)
  val image = imageState.image

  if (image != null) {
    Surface(
      shape = RoundedCornerShape(10.dp),
      border = BorderStroke(1.dp, mobileBorder),
      color = mobileCardSurface,
      modifier = Modifier.fillMaxWidth(),
    ) {
      Image(
        bitmap = image!!,
        contentDescription = mimeType ?: "attachment",
        contentScale = ContentScale.Fit,
        modifier = Modifier.fillMaxWidth(),
      )
    }
  } else if (imageState.failed) {
    Text("Unsupported attachment", style = mobileCaption1, color = mobileTextSecondary)
  }
}

@Composable
private fun DotPulse(color: Color) {
  Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
    PulseDot(alpha = 0.38f, color = color)
    PulseDot(alpha = 0.62f, color = color)
    PulseDot(alpha = 0.90f, color = color)
  }
}

@Composable
private fun PulseDot(alpha: Float, color: Color) {
  Surface(
    modifier = Modifier.size(6.dp).alpha(alpha),
    shape = CircleShape,
    color = color,
  ) {}
}

@Composable
fun ChatCodeBlock(code: String, language: String?) {
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = mobileCodeBg,
    border = BorderStroke(1.dp, mobileCodeBorder),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      if (!language.isNullOrBlank()) {
        Text(
          text = language.uppercase(Locale.US),
          style = mobileCaption2.copy(letterSpacing = 0.4.sp),
          color = mobileTextSecondary,
        )
      }
      Text(
        text = code.trimEnd(),
        fontFamily = FontFamily.Monospace,
        style = mobileCallout,
        color = mobileCodeText,
      )
    }
  }
}

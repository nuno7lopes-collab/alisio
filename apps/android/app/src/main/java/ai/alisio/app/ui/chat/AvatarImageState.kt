package ai.alisio.app.ui.chat

import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

data class AvatarImageState(
  val image: ImageBitmap?,
  val failed: Boolean,
)

@Composable
internal fun rememberAvatarImageState(url: String?): AvatarImageState {
  var image by remember(url) { mutableStateOf<ImageBitmap?>(null) }
  var failed by remember(url) { mutableStateOf(false) }

  LaunchedEffect(url) {
    image = null
    failed = false
    val normalized = url?.trim().orEmpty()
    if (normalized.isEmpty()) {
      return@LaunchedEffect
    }
    image =
      withContext(Dispatchers.IO) {
        runCatching { loadAvatarImage(normalized) }.getOrNull()
      }
    failed = image == null
  }

  return AvatarImageState(image = image, failed = failed)
}

private fun loadAvatarImage(url: String): ImageBitmap? {
  if (url.startsWith("data:image/", ignoreCase = true)) {
    val base64 = url.substringAfter("base64,", missingDelimiterValue = "").trim()
    if (base64.isEmpty()) {
      return null
    }
    return decodeBase64Bitmap(base64, maxDimension = 256)?.asImageBitmap()
  }

  val connection = (URL(url).openConnection() as? HttpURLConnection) ?: return null
  connection.requestMethod = "GET"
  connection.instanceFollowRedirects = true
  connection.connectTimeout = 4_000
  connection.readTimeout = 4_000
  connection.doInput = true
  return try {
    connection.connect()
    if (connection.responseCode !in 200..299) {
      return null
    }
    connection.inputStream.use { input ->
      BitmapFactory.decodeStream(input)?.asImageBitmap()
    }
  } finally {
    connection.disconnect()
  }
}

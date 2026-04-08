package ai.alisio.app.ui

import androidx.compose.runtime.Composable
import ai.alisio.app.MainViewModel
import ai.alisio.app.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}

package ai.alisio.app

object WakeWords {
  const val maxWords: Int = 32
  const val maxWordLength: Int = 64

  fun parseCommaSeparated(input: String): List<String> {
    return input.split(",").map { it.trim() }.filter { it.isNotEmpty() }
  }

  fun parseIfChanged(input: String, current: List<String>): List<String>? {
    val parsed = parseCommaSeparated(input)
    return if (parsed == current) null else parsed
  }

  fun sanitize(words: List<String>, defaults: List<String>): List<String> {
    val cleaned =
      words
        .asSequence()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { it.take(maxWordLength) }
        .distinctBy { it.lowercase() }
        .take(maxWords)
        .toList()
    return cleaned.ifEmpty { defaults }
  }
}

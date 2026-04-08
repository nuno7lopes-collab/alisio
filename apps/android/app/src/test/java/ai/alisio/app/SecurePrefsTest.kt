package ai.alisio.app

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class SecurePrefsTest {
  @Test
  fun loadWakeWords_promotesLegacyBrandFromLegacyPrefsFile() {
    val context = RuntimeEnvironment.getApplication()
    val legacyBrand = listOf("open", "claw").joinToString("")
    val legacyPrefs = context.getSharedPreferences("$legacyBrand.node", Context.MODE_PRIVATE)
    val currentPrefs = context.getSharedPreferences("alisio.node", Context.MODE_PRIVATE)
    legacyPrefs.edit()
      .clear()
      .putString("voiceWake.triggerWords", """["$legacyBrand","claude"]""")
      .commit()
    currentPrefs.edit().clear().commit()

    val prefs = SecurePrefs(context)

    assertEquals(listOf("alisio", "claude"), prefs.wakeWords.value)
    assertEquals("""["alisio","claude"]""", currentPrefs.getString("voiceWake.triggerWords", null))
  }

  @Test
  fun loadLocationMode_migratesLegacyAlwaysValue() {
    val context = RuntimeEnvironment.getApplication()
    val plainPrefs = context.getSharedPreferences("alisio.node", Context.MODE_PRIVATE)
    plainPrefs.edit().clear().putString("location.enabledMode", "always").commit()

    val prefs = SecurePrefs(context)

    assertEquals(LocationMode.WhileUsing, prefs.locationMode.value)
    assertEquals("whileUsing", plainPrefs.getString("location.enabledMode", null))
  }

  @Test
  fun saveGatewayBootstrapToken_persistsSeparatelyFromSharedToken() {
    val context = RuntimeEnvironment.getApplication()
    val securePrefs = context.getSharedPreferences("alisio.node.secure.test", Context.MODE_PRIVATE)
    securePrefs.edit().clear().commit()
    val prefs = SecurePrefs(context, securePrefsOverride = securePrefs)

    prefs.setGatewayToken("shared-token")
    prefs.setGatewayBootstrapToken("bootstrap-token")

    assertEquals("shared-token", prefs.loadGatewayToken())
    assertEquals("bootstrap-token", prefs.loadGatewayBootstrapToken())
    assertEquals("bootstrap-token", prefs.gatewayBootstrapToken.value)
  }
}

package ai.alisio.app.node

import ai.alisio.app.protocol.AlisioCalendarCommand
import ai.alisio.app.protocol.AlisioCameraCommand
import ai.alisio.app.protocol.AlisioCallLogCommand
import ai.alisio.app.protocol.AlisioCapability
import ai.alisio.app.protocol.AlisioContactsCommand
import ai.alisio.app.protocol.AlisioDeviceCommand
import ai.alisio.app.protocol.AlisioLocationCommand
import ai.alisio.app.protocol.AlisioMotionCommand
import ai.alisio.app.protocol.AlisioNotificationsCommand
import ai.alisio.app.protocol.AlisioPhotosCommand
import ai.alisio.app.protocol.AlisioSmsCommand
import ai.alisio.app.protocol.AlisioSystemCommand
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InvokeCommandRegistryTest {
  private val coreCapabilities =
    setOf(
      AlisioCapability.Canvas.rawValue,
      AlisioCapability.Device.rawValue,
      AlisioCapability.Notifications.rawValue,
      AlisioCapability.System.rawValue,
      AlisioCapability.Photos.rawValue,
      AlisioCapability.Contacts.rawValue,
      AlisioCapability.Calendar.rawValue,
    )

  private val optionalCapabilities =
    setOf(
      AlisioCapability.Camera.rawValue,
      AlisioCapability.Location.rawValue,
      AlisioCapability.Sms.rawValue,
      AlisioCapability.CallLog.rawValue,
      AlisioCapability.VoiceWake.rawValue,
      AlisioCapability.Motion.rawValue,
    )

  private val coreCommands =
    setOf(
      AlisioDeviceCommand.Status.rawValue,
      AlisioDeviceCommand.Info.rawValue,
      AlisioDeviceCommand.Permissions.rawValue,
      AlisioDeviceCommand.Health.rawValue,
      AlisioNotificationsCommand.List.rawValue,
      AlisioNotificationsCommand.Actions.rawValue,
      AlisioSystemCommand.Notify.rawValue,
      AlisioPhotosCommand.Latest.rawValue,
      AlisioContactsCommand.Search.rawValue,
      AlisioContactsCommand.Add.rawValue,
      AlisioCalendarCommand.Events.rawValue,
      AlisioCalendarCommand.Add.rawValue,
    )

  private val optionalCommands =
    setOf(
      AlisioCameraCommand.Snap.rawValue,
      AlisioCameraCommand.Clip.rawValue,
      AlisioCameraCommand.List.rawValue,
      AlisioLocationCommand.Get.rawValue,
      AlisioMotionCommand.Activity.rawValue,
      AlisioMotionCommand.Pedometer.rawValue,
      AlisioSmsCommand.Send.rawValue,
      AlisioSmsCommand.Search.rawValue,
      AlisioCallLogCommand.Search.rawValue,
    )

  private val debugCommands = setOf("debug.logs", "debug.ed25519")

  @Test
  fun advertisedCapabilities_respectsFeatureAvailability() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags())

    assertContainsAll(capabilities, coreCapabilities)
    assertMissingAll(capabilities, optionalCapabilities)
  }

  @Test
  fun advertisedCapabilities_includesFeatureCapabilitiesWhenEnabled() {
    val capabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          voiceWakeEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
        ),
      )

    assertContainsAll(capabilities, coreCapabilities + optionalCapabilities)
  }

  @Test
  fun advertisedCommands_respectsFeatureAvailability() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags())

    assertContainsAll(commands, coreCommands)
    assertMissingAll(commands, optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_includesFeatureCommandsWhenEnabled() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(
          cameraEnabled = true,
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          smsSearchPossible = true,
          callLogAvailable = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          debugBuild = true,
        ),
      )

    assertContainsAll(commands, coreCommands + optionalCommands + debugCommands)
  }

  @Test
  fun advertisedCommands_onlyIncludesSupportedMotionCommands() {
    val commands =
      InvokeCommandRegistry.advertisedCommands(
        NodeRuntimeFlags(
          cameraEnabled = false,
          locationEnabled = false,
          sendSmsAvailable = false,
          readSmsAvailable = false,
          smsSearchPossible = false,
          callLogAvailable = false,
          voiceWakeEnabled = false,
          motionActivityAvailable = true,
          motionPedometerAvailable = false,
          debugBuild = false,
        ),
      )

    assertTrue(commands.contains(AlisioMotionCommand.Activity.rawValue))
    assertFalse(commands.contains(AlisioMotionCommand.Pedometer.rawValue))
  }

  @Test
  fun advertisedCommands_splitsSmsSendAndSearchAvailability() {
    val readOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(readSmsAvailable = true, smsSearchPossible = true),
      )
    val sendOnlyCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCommands =
      InvokeCommandRegistry.advertisedCommands(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCommands.contains(AlisioSmsCommand.Search.rawValue))
    assertFalse(readOnlyCommands.contains(AlisioSmsCommand.Send.rawValue))
    assertTrue(sendOnlyCommands.contains(AlisioSmsCommand.Send.rawValue))
    assertFalse(sendOnlyCommands.contains(AlisioSmsCommand.Search.rawValue))
    assertTrue(requestableSearchCommands.contains(AlisioSmsCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_includeSmsWhenEitherSmsPathIsAvailable() {
    val readOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(readSmsAvailable = true),
      )
    val sendOnlyCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(sendSmsAvailable = true),
      )
    val requestableSearchCapabilities =
      InvokeCommandRegistry.advertisedCapabilities(
        defaultFlags(smsSearchPossible = true),
      )

    assertTrue(readOnlyCapabilities.contains(AlisioCapability.Sms.rawValue))
    assertTrue(sendOnlyCapabilities.contains(AlisioCapability.Sms.rawValue))
    assertFalse(requestableSearchCapabilities.contains(AlisioCapability.Sms.rawValue))
  }

  @Test
  fun advertisedCommands_excludesCallLogWhenUnavailable() {
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(callLogAvailable = false))

    assertFalse(commands.contains(AlisioCallLogCommand.Search.rawValue))
  }

  @Test
  fun advertisedCapabilities_excludesCallLogWhenUnavailable() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(callLogAvailable = false))

    assertFalse(capabilities.contains(AlisioCapability.CallLog.rawValue))
  }

  @Test
  fun advertisedCapabilities_includesVoiceWakeWithoutAdvertisingCommands() {
    val capabilities = InvokeCommandRegistry.advertisedCapabilities(defaultFlags(voiceWakeEnabled = true))
    val commands = InvokeCommandRegistry.advertisedCommands(defaultFlags(voiceWakeEnabled = true))

    assertTrue(capabilities.contains(AlisioCapability.VoiceWake.rawValue))
    assertFalse(commands.any { it.contains("voice", ignoreCase = true) })
  }

  @Test
  fun find_returnsForegroundMetadataForCameraCommands() {
    val list = InvokeCommandRegistry.find(AlisioCameraCommand.List.rawValue)
    val location = InvokeCommandRegistry.find(AlisioLocationCommand.Get.rawValue)

    assertNotNull(list)
    assertEquals(true, list?.requiresForeground)
    assertNotNull(location)
    assertEquals(false, location?.requiresForeground)
  }

  @Test
  fun find_returnsNullForUnknownCommand() {
    assertNull(InvokeCommandRegistry.find("not.real"))
  }

  private fun defaultFlags(
    cameraEnabled: Boolean = false,
    locationEnabled: Boolean = false,
    sendSmsAvailable: Boolean = false,
    readSmsAvailable: Boolean = false,
    smsSearchPossible: Boolean = false,
    callLogAvailable: Boolean = false,
    voiceWakeEnabled: Boolean = false,
    motionActivityAvailable: Boolean = false,
    motionPedometerAvailable: Boolean = false,
    debugBuild: Boolean = false,
  ): NodeRuntimeFlags =
    NodeRuntimeFlags(
      cameraEnabled = cameraEnabled,
      locationEnabled = locationEnabled,
      sendSmsAvailable = sendSmsAvailable,
      readSmsAvailable = readSmsAvailable,
      smsSearchPossible = smsSearchPossible,
      callLogAvailable = callLogAvailable,
      voiceWakeEnabled = voiceWakeEnabled,
      motionActivityAvailable = motionActivityAvailable,
      motionPedometerAvailable = motionPedometerAvailable,
      debugBuild = debugBuild,
    )

  private fun assertContainsAll(actual: List<String>, expected: Set<String>) {
    expected.forEach { value -> assertTrue(actual.contains(value)) }
  }

  private fun assertMissingAll(actual: List<String>, forbidden: Set<String>) {
    forbidden.forEach { value -> assertFalse(actual.contains(value)) }
  }
}

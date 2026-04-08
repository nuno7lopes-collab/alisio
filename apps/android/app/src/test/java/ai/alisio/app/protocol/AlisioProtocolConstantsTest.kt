package ai.alisio.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class AlisioProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", AlisioCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", AlisioCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", AlisioCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", AlisioCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", AlisioCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", AlisioCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", AlisioCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", AlisioCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", AlisioCapability.Canvas.rawValue)
    assertEquals("camera", AlisioCapability.Camera.rawValue)
    assertEquals("voiceWake", AlisioCapability.VoiceWake.rawValue)
    assertEquals("location", AlisioCapability.Location.rawValue)
    assertEquals("sms", AlisioCapability.Sms.rawValue)
    assertEquals("device", AlisioCapability.Device.rawValue)
    assertEquals("notifications", AlisioCapability.Notifications.rawValue)
    assertEquals("system", AlisioCapability.System.rawValue)
    assertEquals("photos", AlisioCapability.Photos.rawValue)
    assertEquals("contacts", AlisioCapability.Contacts.rawValue)
    assertEquals("calendar", AlisioCapability.Calendar.rawValue)
    assertEquals("motion", AlisioCapability.Motion.rawValue)
    assertEquals("callLog", AlisioCapability.CallLog.rawValue)
  }

  @Test
  fun cameraCommandsUseStableStrings() {
    assertEquals("camera.list", AlisioCameraCommand.List.rawValue)
    assertEquals("camera.snap", AlisioCameraCommand.Snap.rawValue)
    assertEquals("camera.clip", AlisioCameraCommand.Clip.rawValue)
  }

  @Test
  fun notificationsCommandsUseStableStrings() {
    assertEquals("notifications.list", AlisioNotificationsCommand.List.rawValue)
    assertEquals("notifications.actions", AlisioNotificationsCommand.Actions.rawValue)
  }

  @Test
  fun deviceCommandsUseStableStrings() {
    assertEquals("device.status", AlisioDeviceCommand.Status.rawValue)
    assertEquals("device.info", AlisioDeviceCommand.Info.rawValue)
    assertEquals("device.permissions", AlisioDeviceCommand.Permissions.rawValue)
    assertEquals("device.health", AlisioDeviceCommand.Health.rawValue)
  }

  @Test
  fun systemCommandsUseStableStrings() {
    assertEquals("system.notify", AlisioSystemCommand.Notify.rawValue)
  }

  @Test
  fun photosCommandsUseStableStrings() {
    assertEquals("photos.latest", AlisioPhotosCommand.Latest.rawValue)
  }

  @Test
  fun contactsCommandsUseStableStrings() {
    assertEquals("contacts.search", AlisioContactsCommand.Search.rawValue)
    assertEquals("contacts.add", AlisioContactsCommand.Add.rawValue)
  }

  @Test
  fun calendarCommandsUseStableStrings() {
    assertEquals("calendar.events", AlisioCalendarCommand.Events.rawValue)
    assertEquals("calendar.add", AlisioCalendarCommand.Add.rawValue)
  }

  @Test
  fun motionCommandsUseStableStrings() {
    assertEquals("motion.activity", AlisioMotionCommand.Activity.rawValue)
    assertEquals("motion.pedometer", AlisioMotionCommand.Pedometer.rawValue)
  }

  @Test
  fun smsCommandsUseStableStrings() {
    assertEquals("sms.send", AlisioSmsCommand.Send.rawValue)
    assertEquals("sms.search", AlisioSmsCommand.Search.rawValue)
  }

  @Test
  fun callLogCommandsUseStableStrings() {
    assertEquals("callLog.search", AlisioCallLogCommand.Search.rawValue)
  }

}

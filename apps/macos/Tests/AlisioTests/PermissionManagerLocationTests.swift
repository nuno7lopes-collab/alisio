import CoreLocation
import Testing
import AlisioSupport
@testable import Alisio

struct PermissionManagerLocationTests {
    @Test
    func `authorizedAlways counts for both modes`() {
        #expect(PermissionManager.isLocationAuthorized(status: .authorizedAlways, requireAlways: false))
        #expect(PermissionManager.isLocationAuthorized(status: .authorizedAlways, requireAlways: true))
    }

    @Test
    func `authorized alias counts for both modes on macOS`() {
        #expect(PermissionManager.isLocationAuthorized(status: .authorized, requireAlways: false))
        #expect(PermissionManager.isLocationAuthorized(status: .authorized, requireAlways: true))
    }

    @Test
    func `other statuses not authorized`() {
        #expect(!PermissionManager.isLocationAuthorized(status: .notDetermined, requireAlways: false))
        #expect(!PermissionManager.isLocationAuthorized(status: .denied, requireAlways: false))
        #expect(!PermissionManager.isLocationAuthorized(status: .restricted, requireAlways: false))
    }
}

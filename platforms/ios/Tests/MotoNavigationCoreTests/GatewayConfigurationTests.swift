import Foundation
import XCTest
@testable import MotoNavigationCore

final class GatewayConfigurationTests: XCTestCase {
    func testNormalizesHostAndTrailingSlashWithoutDroppingPrefix() throws {
        XCTAssertEqual(try GatewayConfiguration.normalizedURL("  https://NAV.example.com/moto-gps/api \n").absoluteString,
                       "https://nav.example.com/moto-gps/api/")
        XCTAssertEqual(try GatewayConfiguration.normalizedURL("https://gateway.example.com").absoluteString,
                       "https://gateway.example.com/")
        XCTAssertEqual(try GatewayConfiguration.normalizedURL("https://gateway.example.com:8443/custom/").absoluteString,
                       "https://gateway.example.com:8443/custom/")
    }

    func testRejectsUnsafeAmbiguousAndEndpointAddresses() {
        for address in ["", "http://nav.example.com", "nav.example.com", "https://", "https://example.invalid/",
                        "https://u:p@nav.example.com/", "https://nav.example.com/?key=secret", "https://nav.example.com/#x",
                        "https://nav.example.com/a b", "https://nav.example.com/../api", "https://nav.example.com/%2e%2e/api",
                        "https://nav.example.com:99999", "https://nav.example.com/healthz", "https://nav.example.com/v1/routes"] {
            XCTAssertThrowsError(try GatewayConfiguration.normalizedURL(address), address)
        }
    }

    func testSavedAddressSurvivesReloadAndInvalidSaveDoesNotReplaceIt() throws {
        let suite = "GatewayTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let saved = try GatewayConfiguration.save("https://own.example.com/api", defaults: defaults)
        let reloaded = try XCTUnwrap(UserDefaults(suiteName: suite))
        XCTAssertEqual(GatewayConfiguration.resolvedURL(defaults: reloaded, bundledAddress: "https://other.example.com"), saved)
        XCTAssertThrowsError(try GatewayConfiguration.save("http://bad.example.com", defaults: defaults))
        XCTAssertEqual(GatewayConfiguration.resolvedURL(defaults: defaults, bundledAddress: nil), saved)
    }

    func testCleanInstallUsesValidBuildDefaultButNeverPlaceholder() throws {
        let suite = "GatewayTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        XCTAssertNil(GatewayConfiguration.resolvedURL(defaults: defaults, bundledAddress: "https://example.invalid/moto-gps/api/"))
        defaults.set("not a URL", forKey: GatewayConfiguration.defaultsKey)
        XCTAssertEqual(GatewayConfiguration.resolvedURL(defaults: defaults, bundledAddress: "https://nav.example.com/api")?.absoluteString,
                       "https://nav.example.com/api/")
    }
}

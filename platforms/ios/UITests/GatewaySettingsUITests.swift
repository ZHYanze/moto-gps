import XCTest

final class GatewaySettingsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    // The app bundles a default gateway (MOTOGPSGatewayBaseURL), so the
    // one-time "gateway-setup-button" never appears; the gateway settings
    // are always reachable from the list row "gateway-settings-button".
    func testSaveGatewayPersistsAcrossLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["--moto-ui-offline", "--moto-reset-gateway"]
        app.launch()
        let settings = app.buttons["gateway-settings-button"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        let field = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        replaceText(field, app: app, with: "https://nav.example.com/moto-gps/api")
        keepScreenshot(app, "Gateway address entry")
        app.buttons["gateway-save-button"].tap()
        XCTAssertTrue(app.textFields["destination-search-field"].waitForExistence(timeout: 5))
        app.terminate()
        app.launchArguments = ["--moto-ui-offline"]
        app.launch()
        let settingsAgain = app.buttons["gateway-settings-button"]
        XCTAssertTrue(settingsAgain.waitForExistence(timeout: 5))
        settingsAgain.tap()
        let saved = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertEqual(saved.value as? String, "https://nav.example.com/moto-gps/api/")
        keepScreenshot(app, "Saved gateway settings")
    }

    func testInvalidAddressStaysInSettingsAndExplainsError() {
        let app = XCUIApplication()
        app.launchArguments = ["--moto-ui-offline", "--moto-reset-gateway"]
        app.launch()
        let settings = app.buttons["gateway-settings-button"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        let field = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        replaceText(field, app: app, with: "http://nav.example.com")
        app.buttons["gateway-save-button"].tap()
        let error = app.staticTexts["gateway-status-message"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("HTTPS"))
        keepScreenshot(app, "Invalid gateway address")
    }

    private func replaceText(_ field: XCUIElement, app: XCUIApplication, with text: String) {
        field.tap()
        // Select-all overrides any pre-filled bundled gateway address.
        app.typeKey("a", modifierFlags: .command)
        field.typeText(text)
    }

    private func keepScreenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

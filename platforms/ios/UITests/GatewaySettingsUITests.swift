import XCTest

final class GatewaySettingsUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testSaveGatewayPersistsAcrossLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["--moto-ui-offline", "--moto-reset-gateway"]
        app.launch()
        let setup = app.buttons["gateway-setup-button"]
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        setup.tap()
        let field = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("https://nav.example.com/moto-gps/api")
        keepScreenshot(app, "Gateway address entry")
        app.buttons["gateway-save-button"].tap()
        XCTAssertTrue(app.textFields["destination-search-field"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["gateway-setup-button"].exists)
        app.terminate()
        app.launchArguments = ["--moto-ui-offline"]
        app.launch()
        // This build keeps the gateway settings in the list instead of a
        // top-bar gearshape, so verify persistence through the list row.
        let settings = app.buttons["gateway-settings-button"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let saved = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertEqual(saved.value as? String, "https://nav.example.com/moto-gps/api/")
        keepScreenshot(app, "Saved gateway settings")
    }

    func testInvalidAddressStaysInSettingsAndExplainsError() {
        let app = XCUIApplication()
        app.launchArguments = ["--moto-ui-offline", "--moto-reset-gateway"]
        app.launch()
        let setup = app.buttons["gateway-setup-button"]
        XCTAssertTrue(setup.waitForExistence(timeout: 10))
        setup.tap()
        let field = app.descendants(matching: .any).matching(identifier: "gateway-address-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText("http://nav.example.com")
        app.buttons["gateway-save-button"].tap()
        let error = app.staticTexts["gateway-status-message"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("HTTPS"))
        keepScreenshot(app, "Invalid gateway address")
    }

    private func keepScreenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

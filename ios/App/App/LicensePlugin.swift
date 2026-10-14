import Capacitor

@objc(LicensePlugin)
public class LicensePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LicensePlugin"
    public let jsName = "License"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "activateLicense", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkLicense", returnType: CAPPluginReturnPromise)
    ]

    @objc public func activateLicense(_ call: CAPPluginCall) {
        call.reject("ERR_SERVER_VALIDATION_REQUIRED")
    }

    @objc public func checkLicense(_ call: CAPPluginCall) {
        call.reject("ERR_SERVER_VALIDATION_REQUIRED")
    }
}

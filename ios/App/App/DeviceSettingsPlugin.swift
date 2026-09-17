import Capacitor
import UIKit

@objc(DeviceSettingsPlugin)
public class DeviceSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceSettingsPlugin"
    public let jsName = "DeviceSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("App settings are unavailable.", "SETTINGS_UNAVAILABLE")
                return
            }

            UIApplication.shared.open(url, options: [:]) { opened in
                guard opened else {
                    call.reject("Could not open app settings.", "SETTINGS_OPEN_FAILED")
                    return
                }
                call.resolve()
            }
        }
    }
}

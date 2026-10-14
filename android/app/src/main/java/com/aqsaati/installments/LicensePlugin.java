package com.aqsaati.installments;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "License")
public class LicensePlugin extends Plugin {
    @PluginMethod
    public void activateLicense(PluginCall call) {
        call.reject("ERR_SERVER_VALIDATION_REQUIRED");
    }

    @PluginMethod
    public void checkLicense(PluginCall call) {
        call.reject("ERR_SERVER_VALIDATION_REQUIRED");
    }
}

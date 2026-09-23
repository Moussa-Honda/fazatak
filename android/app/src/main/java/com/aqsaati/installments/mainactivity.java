package com.aqsaati.installments;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.aqsaati.installments.BillingPlugin;
import com.aqsaati.installments.LicensePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LicensePlugin.class);
        registerPlugin(BillingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

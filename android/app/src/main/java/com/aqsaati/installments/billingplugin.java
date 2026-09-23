package com.aqsaati.installments;

import android.app.Activity;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin {
    private static final String DEFAULT_PRODUCT_ID = "aqsaati_yearly";
    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private String pendingProductId;

    @Override
    public void load() {
        super.load();
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this::onPurchasesUpdated)
                .enablePendingPurchases(
                        PendingPurchasesParams.newBuilder()
                                .enableOneTimeProducts()
                                .build()
                )
                .build();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        String productId = call.getString("productId", DEFAULT_PRODUCT_ID);
        withBillingClient(call, () -> queryPurchases(call, productId));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        if (pendingPurchaseCall != null) {
            call.reject("يوجد طلب شراء قيد التنفيذ");
            return;
        }

        String productId = call.getString("productId", DEFAULT_PRODUCT_ID);
        pendingPurchaseCall = call;
        pendingProductId = productId;
        withBillingClient(call, () -> queryProductAndLaunch(productId));
    }

    private void withBillingClient(PluginCall call, Runnable action) {
        if (billingClient == null) {
            call.reject("تعذر تهيئة Google Play Billing");
            return;
        }
        if (billingClient.isReady()) {
            action.run();
            return;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    action.run();
                } else {
                    if (call == pendingPurchaseCall) {
                        rejectPending("تعذر الاتصال بـ Google Play Billing: " + result.getDebugMessage());
                    } else {
                        call.reject("تعذر الاتصال بـ Google Play Billing: " + result.getDebugMessage());
                    }
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                if (call == pendingPurchaseCall) {
                    rejectPending("انقطع الاتصال بخدمة Google Play Billing");
                } else {
                    call.reject("انقطع الاتصال بخدمة Google Play Billing");
                }
            }
        });
    }

    private void queryProductAndLaunch(String productId) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(
                        QueryProductDetailsParams.Product.newBuilder()
                                .setProductId(productId)
                                .setProductType(BillingClient.ProductType.SUBS)
                                .build()
                ))
                .build();

        billingClient.queryProductDetailsAsync(params, (result, queryResult) -> {
            List<ProductDetails> products = queryResult == null
                    ? null
                    : queryResult.getProductDetailsList();
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || products == null || products.isEmpty()) {
                rejectPending("لم يتم العثور على اشتراك Google Play. تأكد من إنشاء المنتج داخل Play Console.");
                return;
            }

            ProductDetails product = products.get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers = product.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                rejectPending("لا يوجد عرض اشتراك متاح لهذا المنتج في Google Play.");
                return;
            }

            ProductDetails.SubscriptionOfferDetails offer = offers.get(0);
            BillingFlowParams.ProductDetailsParams productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(product)
                    .setOfferToken(offer.getOfferToken())
                    .build();
            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(productParams))
                    .build();

            Activity activity = getActivity();
            if (activity == null) {
                rejectPending("تعذر فتح نافذة الدفع");
                return;
            }
            BillingResult launchResult = billingClient.launchBillingFlow(activity, flowParams);
            if (launchResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                rejectPending("تعذر بدء عملية الدفع: " + launchResult.getDebugMessage());
            }
        });
    }

    private void queryPurchases(PluginCall call, String productId) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
        billingClient.queryPurchasesAsync(params, (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("تعذر قراءة اشتراك Google Play: " + result.getDebugMessage());
                return;
            }

            for (Purchase purchase : purchases) {
                if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                        && purchase.getProducts().contains(productId)) {
                    acknowledgeIfNeeded(purchase, call, true);
                    return;
                }
            }
            resolveStatus(call, false, null);
        });
    }

    private void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        if (call == null) return;

        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            pendingPurchaseCall = null;
            pendingProductId = null;
            if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
                call.reject("تم إلغاء عملية الشراء");
            } else {
                call.reject("فشلت عملية الشراء: " + result.getDebugMessage());
            }
            return;
        }

        for (Purchase purchase : purchases) {
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                    && purchase.getProducts().contains(pendingProductId)) {
                acknowledgeIfNeeded(purchase, call, false);
                return;
            }
        }

        pendingPurchaseCall = null;
        pendingProductId = null;
        call.reject("لم تكتمل عملية شراء الاشتراك");
    }

    private void acknowledgeIfNeeded(Purchase purchase, PluginCall call, boolean statusOnly) {
        Runnable resolve = () -> {
            if (statusOnly) {
                resolveStatus(call, true, purchase.getPurchaseToken());
            } else {
                JSObject result = new JSObject();
                result.put("active", true);
                result.put("productId", pendingProductId);
                result.put("purchaseToken", purchase.getPurchaseToken());
                pendingPurchaseCall = null;
                pendingProductId = null;
                call.resolve(result);
            }
        };

        if (purchase.isAcknowledged()) {
            resolve.run();
            return;
        }

        billingClient.acknowledgePurchase(
                com.android.billingclient.api.AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchase.getPurchaseToken())
                        .build(),
                result -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        resolve.run();
                    } else if (statusOnly) {
                        call.reject("تعذر تأكيد اشتراك Google Play: " + result.getDebugMessage());
                    } else {
                        pendingPurchaseCall = null;
                        pendingProductId = null;
                        call.reject("تعذر تأكيد عملية الشراء: " + result.getDebugMessage());
                    }
                }
        );
    }

    private void resolveStatus(PluginCall call, boolean active, String purchaseToken) {
        JSObject result = new JSObject();
        result.put("active", active);
        if (purchaseToken != null) result.put("purchaseToken", purchaseToken);
        call.resolve(result);
    }

    private void rejectPending(String message) {
        if (pendingPurchaseCall != null) {
            PluginCall call = pendingPurchaseCall;
            pendingPurchaseCall = null;
            pendingProductId = null;
            call.reject(message);
        }
    }
}

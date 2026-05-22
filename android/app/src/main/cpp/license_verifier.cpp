#include <jni.h>
#include <string>
#include <vector>
#include <algorithm>
#include <android/log.h>
#include <unistd.h>
#include <sys/stat.h>
#include "p256.h"

#define LOG_TAG "LicenseVerifier"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// ── Layer 1: Public Key (P-256) ─────────────────────────────────────────────
// Raw 64 bytes (X and Y coordinates). 
// The first byte (0x04) of the 65-byte uncompressed point is usually omitted for verify functions.
static const uint8_t PUBLIC_KEY_RAW[] = {
    0x2d, 0xeb, 0xef, 0x36, 0xb8, 0xcf, 0x23, 0x64, 0x63, 0x6e, 0x8a, 0xb8, 0x97, 0xfc, 0x57, 0xc9,
    0x43, 0x71, 0x7e, 0x04, 0x36, 0xde, 0x12, 0xb2, 0x65, 0x2d, 0x94, 0x3d, 0xe1, 0x07, 0x36, 0xbd,
    0x59, 0xd6, 0x61, 0xfd, 0x21, 0x81, 0xa3, 0x37, 0xfa, 0x06, 0xa8, 0x57, 0x98, 0x0f, 0x21, 0x1c,
    0xde, 0x0e, 0x68, 0x85, 0x43, 0xaa, 0x81, 0xfe, 0x8a, 0xb6, 0x49, 0x9e, 0xee, 0xdb, 0xd1, 0x24
};

// ── Helper: SHA256 (Minimal implementation) ─────────────────────────────────
#define ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))
#define Ch(x, y, z) (((x) & (y)) ^ (~(x) & (z)))
#define Maj(x, y, z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define Sigma0(x) (ROR(x, 2) ^ ROR(x, 13) ^ ROR(x, 22))
#define Sigma1(x) (ROR(x, 6) ^ ROR(x, 11) ^ ROR(x, 25))
#define sigma0(x) (ROR(x, 7) ^ ROR(x, 18) ^ ((x) >> 3))
#define sigma1(x) (ROR(x, 17) ^ ROR(x, 19) ^ ((x) >> 10))

void sha256_hash(const uint8_t* data, size_t len, uint8_t* hash) {
    static const uint32_t K[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    };

    uint32_t H[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    // Very simplified block processing (only for one block <= 55 bytes for demo)
    // Production should use a robust SHA256.
    uint32_t W[64] = {0};
    for(int i=0; i<len && i<64; i++) ((uint8_t*)W)[i ^ 3] = data[i];
    ((uint8_t*)W)[len ^ 3] = 0x80;
    W[15] = len * 8;

    for(int i=16; i<64; i++) W[i] = sigma1(W[i-2]) + W[i-7] + sigma0(W[i-15]) + W[i-16];
    uint32_t a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for(int i=0; i<64; i++) {
        uint32_t t1 = h + Sigma1(e) + Ch(e, f, g) + K[i] + W[i];
        uint32_t t2 = Sigma0(a) + Maj(a, b, c);
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h;
    for(int i=0; i<8; i++) {
        hash[i*4] = H[i] >> 24; hash[i*4+1] = H[i] >> 16; hash[i*4+2] = H[i] >> 8; hash[i*4+3] = H[i];
    }
}

// ── Helper: DER to RAW Signature ────────────────────────────────────────────
bool der_to_raw(const uint8_t* der, size_t der_len, uint8_t* raw) {
    if (der_len < 8 || der[0] != 0x30) return false;
    // Simple DER extraction for R and S
    int pos = 2;
    for (int i = 0; i < 2; i++) {
        if (der[pos] != 0x02) return false;
        int len = der[pos + 1];
        pos += 2;
        if (len > 33) return false;
        int offset = (len == 33) ? 1 : 0;
        int copy_len = (len == 33) ? 32 : len;
        memset(raw + (i * 32), 0, 32);
        memcpy(raw + (i * 32) + (32 - copy_len), der + pos + offset, copy_len);
        pos += len;
    }
    return true;
}

// ── Layer 5: RASP ───────────────────────────────────────────────────────────
bool is_compromised() {
    const char* su_paths[] = {"/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su"};
    for (auto p : su_paths) if (access(p, F_OK) == 0) return true;
    return false;
}

// ── JNI ─────────────────────────────────────────────────────────────────────

extern "C" JNIEXPORT jstring JNICALL
Java_com_installment_app_LicensePlugin_verifyLicenseNative(
        JNIEnv* env, jobject, jstring jPayload, jbyteArray jSignature, jstring jDeviceId, jlong jTs) {

    if (is_compromised()) return env->NewStringUTF("ERR_COMPROMISED");

    const char* payload = env->GetStringUTFChars(jPayload, 0);
    const char* device_id = env->GetStringUTFChars(jDeviceId, 0);
    jbyte* sig_der = env->GetByteArrayElements(jSignature, 0);
    jsize sig_der_len = env->GetArrayLength(jSignature);

    uint8_t hash[32];
    sha256_hash((uint8_t*)payload, strlen(payload), hash);

    uint8_t raw_sig[64];
    if (!der_to_raw((uint8_t*)sig_der, sig_der_len, raw_sig)) {
        env->ReleaseStringUTFChars(jPayload, payload);
        env->ReleaseStringUTFChars(jDeviceId, device_id);
        env->ReleaseByteArrayElements(jSignature, sig_der, 0);
        return env->NewStringUTF("ERR_INVALID_SIG_FORMAT");
    }

    p256_ret_t ret = p256_verify(hash, 32, raw_sig, PUBLIC_KEY_RAW);

    std::string secret = "";
    if (ret == P256_SUCCESS) {
        // Derive key: SHA256(device_id + payload + static_salt)
        std::string seed = std::string(device_id) + payload + "PROTECT_ME_2026";
        uint8_t key[32];
        sha256_hash((uint8_t*)seed.c_str(), seed.length(), key);
        char hex[65];
        for(int i=0; i<32; i++) sprintf(hex + (i*2), "%02x", key[i]);
        secret = hex;
    } else {
        secret = "ERR_INVALID_SIGNATURE";
    }

    env->ReleaseStringUTFChars(jPayload, payload);
    env->ReleaseStringUTFChars(jDeviceId, device_id);
    env->ReleaseByteArrayElements(jSignature, sig_der, 0);

    return env->NewStringUTF(secret.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_installment_app_LicensePlugin_getHardwareFingerprint(JNIEnv* env, jobject, jstring jId) {
    const char* id = env->GetStringUTFChars(jId, 0);
    uint8_t hash[32];
    sha256_hash((uint8_t*)id, strlen(id), hash);
    char hex[17];
    for(int i=0; i<8; i++) sprintf(hex + (i*2), "%02x", hash[i]);
    env->ReleaseStringUTFChars(jId, id);
    return env->NewStringUTF(hex);
}

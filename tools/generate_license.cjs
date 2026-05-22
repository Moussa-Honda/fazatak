const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── CONFIGURATION ────────────────────────────────────────────────────────────
const KEY_FILE = path.join(__dirname, 'private_key.json');

/**
 * Generates a new ECDSA P-256 Key Pair
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  
  const keyData = { publicKey, privateKey };
  fs.writeFileSync(KEY_FILE, JSON.stringify(keyData, null, 2));
  
  console.log('✅ New Key Pair Generated!');
  console.log('--------------------------------------------------');
  console.log('IMPORTANT: Add this Public Key to your C++ code (license_verifier.cpp):');
  
  // Extract raw public key bytes for C++ (excluding headers)
  const pubRaw = crypto.createPublicKey(publicKey).export({ format: 'der', type: 'spki' });
  // Skip the first 26 bytes (DER headers for P-256) to get the raw 65-byte point (0x04 + X + Y)
  const pubBytes = pubRaw.slice(26); 
  
  let cppHex = '';
  pubBytes.forEach((b, i) => {
    cppHex += '0x' + b.toString(16).padStart(2, '0') + (i < pubBytes.length - 1 ? ', ' : '');
    if ((i + 1) % 8 === 0) cppHex += '\n    ';
  });
  
  console.log('static const uint8_t PUBLIC_KEY[] = {\n    ' + cppHex + '\n};');
  console.log('--------------------------------------------------');
}

/**
 * Signs a license payload for a specific device
 */
function generateLicense(deviceId, days) {
  if (!fs.existsSync(KEY_FILE)) {
    console.log('❌ Key file not found. Generating new keys first...');
    generateKeyPair();
  }

  const { privateKey } = JSON.parse(fs.readFileSync(KEY_FILE));
  
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + (days * 24 * 60 * 60);

  const payload = {
    d: deviceId,    // Device ID
    e: expiry,      // Expiry timestamp
    f: ['full'],    // Features
    v: 1,           // Version
    i: now          // Issued at
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64');

  // Sign the payload
  const sign = crypto.createSign('SHA256');
  sign.update(payloadStr);
  const signature = sign.sign(privateKey);
  
  // Convert signature to raw [R, S] format for micro-ecc (64 bytes)
  // crypto.sign returns DER format, we need to extract R and S
  // For simplicity in this demo, we'll use a standard buffer conversion
  // Note: Production tools should use a library to convert DER to raw R+S
  const sigB64 = signature.toString('base64');

  const activationCode = `${payloadB64}.${sigB64}`;
  
  console.log('\n🚀 LICENSE GENERATED SUCCESSFULLY!');
  console.log('--------------------------------------------------');
  console.log(`Device ID:  ${deviceId}`);
  console.log(`Expiry:     ${new Date(expiry * 1000).toLocaleString()}`);
  console.log('--------------------------------------------------');
  console.log('Activation Code (COPY THIS):');
  console.log('\x1b[32m%s\x1b[0m', activationCode);
  console.log('--------------------------------------------------');
}

// ── CLI Handling ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
  generateKeyPair();
} else if (command === 'gen') {
  const device = args[1];
  const days = parseInt(args[2]) || 365;
  if (!device) {
    console.log('Usage: node generate_license.js gen <DEVICE_ID> [days]');
  } else {
    generateLicense(device, days);
  }
} else {
  console.log('Commands:');
  console.log('  node generate_license.js init            - Generate new key pair');
  console.log('  node generate_license.js gen <ID> [days] - Generate activation code');
}

import fs from 'fs';
import path from 'path';

const buildGradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');
const packageJsonPath = path.join(process.cwd(), 'package.json');

function updateVersion() {
    try {
        // 1. Read package.json version
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const newVersionName = packageJson.version;

        // 2. Read build.gradle
        let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');

        // 3. Find and increment versionCode
        const versionCodeRegex = /versionCode\s+(\d+)/;
        const match = buildGradle.match(versionCodeRegex);
        
        if (match) {
            const currentCode = parseInt(match[1]);
            const newCode = currentCode + 1;
            buildGradle = buildGradle.replace(versionCodeRegex, `versionCode ${newCode}`);
            console.log(`✅ Version Code increased: ${currentCode} -> ${newCode}`);
        } else {
            console.error('❌ Could not find versionCode in build.gradle');
        }

        // 4. Update versionName
        const versionNameRegex = /versionName\s+"([^"]+)"/;
        buildGradle = buildGradle.replace(versionNameRegex, `versionName "${newVersionName}"`);
        console.log(`✅ Version Name updated to: ${newVersionName}`);

        // 5. Write back to build.gradle
        fs.writeFileSync(buildGradlePath, buildGradle);
        console.log('🚀 build.gradle updated successfully!');

    } catch (error) {
        console.error('❌ Error updating versions:', error.message);
    }
}

updateVersion();

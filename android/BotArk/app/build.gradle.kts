plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.qybaihe.botark"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.qybaihe.botark"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.03.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    // Serves the bundled Linux renderer from an https:// appassets origin so
    // ES modules, WebGL (GrokBotMark) and localStorage work inside the WebView.
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    // Networking & Zero-Server Sync (HTTP + WebSocket + SSE)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Encrypted Local Keystore Vault
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Native CameraX + ZXing QR Code Scanner (100% offline, zero Google Play Services dependency!)
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

// The Android workspace is the Linux renderer bundle. Build it from the repo
// root and package it under src/main/assets/web on every APK build, so the
// phone can never drift from the desktop interaction model again.
val repoRootDir = rootProject.projectDir.parentFile.parentFile
val buildWebRenderer = tasks.register<Exec>("buildWebRenderer") {
    workingDir = repoRootDir
    commandLine("npm", "run", "build:web")
    inputs.files(
        repoRootDir.resolve("src/renderer"),
        repoRootDir.resolve("src/shared"),
        repoRootDir.resolve("vite.web.config.mts"),
        repoRootDir.resolve("vite.shared.mts")
    )
    outputs.dir(repoRootDir.resolve("dist/web"))
}

val copyWebRenderer = tasks.register<Sync>("copyWebRenderer") {
    dependsOn(buildWebRenderer)
    from(repoRootDir.resolve("dist/web"))
    into(layout.projectDirectory.dir("src/main/assets/web"))
}

tasks.named("preBuild") {
    dependsOn(copyWebRenderer)
}

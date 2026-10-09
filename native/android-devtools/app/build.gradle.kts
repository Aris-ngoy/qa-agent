plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "yoqa.android.devtools"
    compileSdk = 36

    defaultConfig {
        applicationId = "yoqa.android.devtools"
        minSdk = 24
        targetSdk = 36
        // Bump together with DEVTOOLS_VERSION_CODE in services/runner/src/domains/devices/android-devtools.ts.
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

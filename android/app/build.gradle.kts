plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aiuniversal.signalradar"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.aiuniversal.signalradar"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.0"
        buildConfigField("String", "BACKEND_URL", "\"https://ai-universal-signal-radar-main.onrender.com\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.google.mlkit:text-recognition:16.0.1")
}

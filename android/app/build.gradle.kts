plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun requiredBuildSecret(name: String): String =
    providers.environmentVariable(name).orNull
        ?.takeIf { it.isNotBlank() }
        ?: throw GradleException("Missing required GitHub Actions secret: $name")

fun quotedBuildConfig(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.aiuniversal.signalradar"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.aiuniversal.signalradar"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "1.2.0"
        buildConfigField("String", "BACKEND_URL", quotedBuildConfig(requiredBuildSecret("BACKEND_URL").trimEnd('/')))
        buildConfigField("String", "OCR_API_TOKEN", quotedBuildConfig(requiredBuildSecret("OCR_API_TOKEN")))
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

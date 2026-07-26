plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "tv.berserker.client"
  compileSdk = 35

  defaultConfig {
    applicationId = "tv.berserker.client"
    minSdk = 23 // Android 6.0，涵蓋絕大多數仍在服役的 Android TV
    targetSdk = 35
    versionCode = 1
    versionName = "1.0.0"
  }

  buildTypes {
    release {
      // 以 debug 金鑰簽章，讓 CI 產出的 APK 可以直接側載安裝。
      // 這不是上架用的正式簽章，僅供自架使用者自行安裝。
      signingConfig = signingConfigs.getByName("debug")
      isMinifyEnabled = false
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
    viewBinding = false
  }
}

dependencies {
  // 只用到框架內建的 android.webkit.WebView，不需要 androidx.webkit
  implementation("androidx.appcompat:appcompat:1.7.0")
}

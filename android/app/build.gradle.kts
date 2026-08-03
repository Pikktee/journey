// App-Modul: Kotlin + Compose (Material 3), Room via KSP, WorkManager, CameraX.
// minSdk 29: Foreground-Service-Tracking ohne ACCESS_BACKGROUND_LOCATION
// (Start im Vordergrund), Scoped Storage ab Tag 1.

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

/**
 * Die Version des Repos — DIE eine Nummer, die auch `npm run release` anhebt.
 *
 * Sie stand hier lange ein zweites Mal und wurde von Hand gepflegt; genau das
 * lief auseinander: Der App-Code änderte sich zweimal, die Nummer blieb stehen,
 * und am Gerät war nicht mehr zu erkennen, welcher Stand installiert ist. Wer
 * die Zahl hier wieder fest einträgt, holt sich das zurück.
 */
val repoVersion: String = run {
    val datei = rootProject.file("../package.json")
    val treffer = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(datei.readText())
    treffer?.groupValues?.get(1) ?: error("Keine version in ${datei.path} gefunden")
}

/**
 * `versionCode` aus der Version: 0.33.0 → 3300.
 *
 * Android verlangt eine ganze Zahl, die NIE kleiner wird — sonst verweigert das
 * Gerät das Update. Die Rechnung hält die Reihenfolge von semver ein, solange
 * Minor und Patch unter 100 bleiben; darüber würde 0.100.0 hinter 1.0.0 fallen,
 * deshalb bricht der Build dort lieber ab.
 */
fun versionsZahl(version: String): Int {
    val teile = version.split(".").map { it.toIntOrNull() ?: error("Unlesbare Version: $version") }
    require(teile.size == 3) { "Version braucht drei Teile: $version" }
    val (major, minor, patch) = teile
    require(minor < 100 && patch < 100) { "Minor/Patch ab 100 kippen die Reihenfolge: $version" }
    return major * 10000 + minor * 100 + patch
}

android {
    namespace = "app.maptale"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.maptale"
        minSdk = 29
        targetSdk = 35
        versionName = repoVersion
        versionCode = versionsZahl(repoVersion)
    }

    buildTypes {
        release {
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

    // Welcher Schlüssel den Debug-Build signiert, entscheidet, ob ein neuer APK
    // eine vorhandene Installation AKTUALISIEREN kann: Android verlangt dieselbe
    // Signatur, sonst bleibt nur Deinstallieren. Lokal ist das der Schlüssel aus
    // ~/.android — auf einem CI-Läufer entstünde bei jedem Lauf ein neuer, und
    // jedes Release wäre für Bestandsinstallationen unbrauchbar. Deshalb lässt
    // er sich über die Umgebung hereinreichen (Workflow: deploy.yml).
    signingConfigs {
        getByName("debug") {
            val hinterlegt = System.getenv("MAPTALE_DEBUG_KEYSTORE")?.takeIf { it.isNotBlank() }
            if (hinterlegt != null) {
                storeFile = file(hinterlegt)
                // Die Vorgaben sind die von Android selbst vergebenen — ein
                // Debug-Keystore ist kein Geheimnis, sondern eine Identität.
                storePassword = System.getenv("MAPTALE_DEBUG_KEYSTORE_PASSWORT") ?: "android"
                keyAlias = System.getenv("MAPTALE_DEBUG_KEY_ALIAS") ?: "androiddebugkey"
                keyPassword = System.getenv("MAPTALE_DEBUG_KEY_PASSWORT") ?: "android"
            }
        }
    }

    buildFeatures {
        compose = true
        // Ohne das gäbe es kein BuildConfig.VERSION_NAME — und die App könnte
        // nicht sagen, welcher Stand sie ist (AGP 8 schaltet es standardmäßig ab).
        buildConfig = true
    }

    // Room legt je Schema-Version eine JSON-Datei ab. Sie ist die Vergleichsbasis
    // für Migrationstests: ohne sie lässt sich nicht prüfen, ob eine Migration die
    // alte Datenbank wirklich in die neue Form überführt.
    ksp {
        arg("room.schemaLocation", "$projectDir/schemas")
    }
    sourceSets.getByName("test") {
        assets.srcDir("$projectDir/schemas")
    }

    testOptions {
        unitTests {
            // Robolectric braucht die Android-Ressourcen
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.exifinterface)

    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.androidx.camera.video)

    implementation(libs.coil.compose)
    implementation(libs.coil.video)

    implementation(libs.play.services.location)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
